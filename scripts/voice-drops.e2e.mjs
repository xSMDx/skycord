#!/usr/bin/env node
/**
 * The voice list against the real call, with the network failing on purpose.
 *
 * Two headless browsers sign in as two people who share a server. A joins the
 * voice channel; B watches the channel's member list. The script then breaks
 * A's connections the ways a shaky network does and checks, after each, that
 * B's list (the rendered rows, not just the data behind them) shows A exactly
 * when the media server says A is in the room.
 *
 * The socket goes through a relay this script controls. A "cut" closes the
 * browser's side of A's socket at once — the browser reconnects within a
 * couple of seconds — and holds the API's side open, silent, until the API
 * gives up on it by its own ping timeout. That is the order a real network
 * change produces (the browser learns first, the server up to 15 s later), and
 * the order that used to take people out of the list. A clean disconnect from
 * the browser would not show the bug, because the server hears about it first.
 *
 * Scenarios:
 *   S1  A's socket drops and comes back; LiveKit stays up
 *   S2  LiveKit reconnects inside the SDK; the socket stays up
 *   S3  LiveKit drops the room and the app rejoins it; the socket stays up
 *   S4  both at once
 *   S5  A's socket stays down for longer than the call-end grace period while
 *       A is still in a DM call (no "Call ended" while A is in the room)
 *   S6  A joins the same channel from a second tab (one takes over, no fight)
 *
 * Needs, already running (nothing here starts a window):
 *   MongoDB  on 127.0.0.1:27017       docker run -d --name e2e-mongo -p 27017:27017 mongo:4.4
 *   LiveKit  on ws://127.0.0.1:17880  with the key and secret below, and its
 *            RTC ports published as themselves (17881/tcp, 17882/udp), e.g.
 *            docker run -d --name e2e-livekit -p 17880:7880 -p 17881:17881 -p 17882:17882/udp \
 *              livekit/livekit-server:v1.13.11 --bind 0.0.0.0 --node-ip 127.0.0.1 \
 *              --keys "devkey: secretsecretsecretsecretsecret12" \
 *              --config-body "rtc: {tcp_port: 17881, udp_port: 17882, use_external_ip: false}"
 * and playwright-core (PLAYWRIGHT_CORE=<path to the package> if it is not
 * installed in this checkout; E2E_CHROME_CHANNEL=chrome to drive the installed
 * Chrome, headless, instead of a browser Playwright downloaded). Starts on its own, from this checkout: the API
 * (on E2E_API_PORT, behind the relay) and Vite. Uses its own database, which
 * it empties first.
 *
 *   node scripts/voice-drops.e2e.mjs            every scenario
 *   node scripts/voice-drops.e2e.mjs S1 S4      just those
 *
 * Exits 0 when every check passed, 1 otherwise. Prints one line per check.
 */
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import mongoose from 'mongoose'
import { RoomServiceClient } from 'livekit-server-sdk'

const require = createRequire(import.meta.url)
// E2E_ROOT runs the API and Vite from another checkout of the same repo — to
// watch an older build fail the same checks.
const root = process.env.E2E_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')

const CFG = {
  api: Number(process.env.E2E_API_PORT ?? 3401),
  relay: Number(process.env.E2E_RELAY_PORT ?? 3402),
  web: Number(process.env.E2E_WEB_PORT ?? 4473),
  mongo: process.env.E2E_MONGO_URI ?? 'mongodb://127.0.0.1:27017/sykord_e2e_voice',
  livekit: {
    url: process.env.E2E_LIVEKIT_URL ?? 'ws://127.0.0.1:17880',
    key: process.env.E2E_LIVEKIT_KEY ?? 'devkey',
    secret: process.env.E2E_LIVEKIT_SECRET ?? 'secretsecretsecretsecretsecret12',
  },
}
const WEB = `http://localhost:${CFG.web}`
const only = new Set(process.argv.slice(2).filter(a => /^S\d$/.test(a)))
const wanted = s => only.size === 0 || only.has(s)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

// ── Checks ─────────────────────────────────────────────────────────────────
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
/** Poll until `fn` returns truthy or the time is up; returns the last value. */
const waitFor = async (fn, ms, every = 250) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await sleep(every)
  }
  return last
}

// ── The relay in front of the API ─────────────────────────────────────────
/**
 * Every connection Vite opens to the API passes through here. Socket upgrades
 * are tagged with the browser they came from (its user agent carries
 * "SkycordE2E/<name>"), so one person's socket can be cut without touching
 * the other's.
 */
class Relay {
  conns = new Set()
  blocked = new Set()
  /**
   * When the API gave up on each held leg: the late disconnect, observed. Its
   * WebSocket close frame is the moment Socket.IO drops the connection; the
   * TCP close comes up to 30 s later, once the close handshake that nobody
   * answers times out.
   */
  heldClosed = []
  constructor(listen, target) { this.listen = listen; this.target = target }

  start() {
    this.server = net.createServer(client => {
      const c = { client, upstream: net.connect(this.target, '127.0.0.1'), tag: null, upgrade: false, held: false }
      this.conns.add(c)
      let head = Buffer.alloc(0)
      let decided = false
      client.on('data', chunk => {
        if (!decided) {
          head = Buffer.concat([head, chunk])
          const end = head.indexOf('\r\n\r\n')
          if (end === -1 && head.length < 32768) return
          decided = true
          const text = head.subarray(0, end === -1 ? head.length : end).toString('latin1')
          c.upgrade = /\r\nupgrade:\s*websocket/i.test(text)
          c.tag = /SkycordE2E\/(\w+)/.exec(text)?.[1] ?? null
          if (c.upgrade && c.tag && this.blocked.has(c.tag)) { client.destroy(); c.upstream.destroy(); return }
          c.upstream.write(head)
          return
        }
        if (!c.held) c.upstream.write(chunk)
      })
      c.upstream.on('data', chunk => {
        if (!c.held) { client.write(chunk); return }
        // 0x88: a final WebSocket close frame, from the API to a browser that is gone.
        if (chunk[0] === 0x88 && !c.closeSeen) { c.closeSeen = true; this.heldClosed.push({ tag: c.tag, at: Date.now() }) }
      })
      client.on('close', () => { if (!c.held) c.upstream.destroy() })
      c.upstream.on('close', () => {
        if (c.held && !c.closeSeen) this.heldClosed.push({ tag: c.tag, at: Date.now() })
        client.destroy()
        this.conns.delete(c)
      })
      client.on('error', () => {})
      c.upstream.on('error', () => {})
    })
    return new Promise(r => this.server.listen(this.listen, '127.0.0.1', r))
  }

  /** Close the browser's side of `tag`'s sockets now; hold the API's side open and silent. */
  cut(tag) {
    let n = 0
    for (const c of this.conns) {
      if (!c.upgrade || c.tag !== tag || c.held) continue
      c.held = true
      c.client.destroy()
      n++
    }
    return n
  }
  block(tag) { this.blocked.add(tag) }
  unblock(tag) { this.blocked.delete(tag) }
  stop() { for (const c of this.conns) { c.client.destroy(); c.upstream.destroy() } this.server?.close() }
}

// ── Processes ─────────────────────────────────────────────────────────────
const children = []
const startProcess = (name, args, env) => {
  const child = spawn('npx', args, { cwd: root, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const tail = []
  const keep = d => { tail.push(...String(d).split(/\r?\n/).filter(Boolean)); tail.splice(0, Math.max(0, tail.length - 40)) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  children.push({ name, child, tail })
  return { child, tail }
}
const stopProcesses = () => {
  for (const { child } of children) {
    if (child.exitCode !== null) continue
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    } catch { /* already gone */ }
  }
}
const httpUp = async url => { try { const r = await fetch(url); return r.status < 500 } catch { return false } }

// ── The media server's own answer ─────────────────────────────────────────
const lk = new RoomServiceClient(CFG.livekit.url.replace(/^ws/, 'http'), CFG.livekit.key, CFG.livekit.secret)
/** Who LiveKit has in the room right now (people only). */
const roster = async room => {
  try { return (await lk.listParticipants(room)).map(p => p.identity).filter(id => !id.includes(':')) }
  catch (e) { if (e?.code === 'not_found' || e?.status === 404) return []; throw e }
}

// ── The app, as each person sees it ───────────────────────────────────────
const api = async (pathname, { token, body, method = body ? 'POST' : 'GET' } = {}) => {
  const r = await fetch(`http://127.0.0.1:${CFG.api}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status} ${JSON.stringify(json)}`)
  return json
}

/** What a page knows: its socket, its call, and the server's list for `room`. */
const stateOf = (page, room) => page.evaluate(async room => {
  const s = await import('/src/composables/useSocket.ts')
  const v = await import('/src/composables/useVoice.ts')
  return {
    socket: s.connected.value,
    inCall: v.voice.connected,
    conv: v.voice.activeConvId,
    list: s.activeCalls.value[room] ?? [],
  }
}, room)

/** The names in the voice channel's member rows, as rendered. */
const rowsOf = page => page.$$eval('.vc-occ-name', els => els.map(e => e.textContent.trim()))

const join = (page, convId, kind, name) => page.evaluate(async ([convId, kind, name]) => {
  const v = await import('/src/composables/useVoice.ts')
  await v.useVoice().connect(convId, kind, name)
}, [convId, kind, name])
const leave = page => page.evaluate(async () => (await import('/src/composables/useVoice.ts')).useVoice().leave())
const simulate = (page, scenario) => page.evaluate(async scenario => {
  const r = (await import('/src/composables/voiceRoom.ts')).getRoom()
  if (!r) throw new Error('no room')
  await r.simulateScenario(scenario)
}, scenario)

const signIn = async (page, who) => {
  // A cold Vite compiles the whole app on the first load.
  page.setDefaultTimeout(90_000)
  await page.goto(WEB)
  await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password }),
    })
    if (!r.ok) throw new Error(`login ${r.status}`)
  }, who)
  await page.reload()
  const up = await waitFor(() => page.evaluate(async () => {
    const s = await import('/src/composables/useSocket.ts')
    return s.connected.value
  }).catch(() => false), 90_000)
  if (!up) throw new Error(`${who.name}: no socket after sign-in`)
}

// ── Run ───────────────────────────────────────────────────────────────────
const main = async () => {
  const relay = new Relay(CFG.relay, CFG.api)
  const instanceDir = path.join(tmpdir(), `skycord-e2e-instance-${process.pid}`)
  mkdirSync(instanceDir, { recursive: true })
  let browser
  try {
    await mongoose.connect(CFG.mongo)
    await mongoose.connection.dropDatabase()
    await relay.start()

    log('starting the API and Vite')
    const apiProc = startProcess('api', ['ts-node', '--project', 'tsconfig.server.json', '--transpile-only', 'server/index.ts'], {
      NODE_ENV: 'development', PORT: String(CFG.api), MONGO_URI: CFG.mongo,
      JWT_ACCESS_SECRET: 'e2e-access-secret', JWT_REFRESH_SECRET: 'e2e-refresh-secret',
      LIVEKIT_URL: CFG.livekit.url, LIVEKIT_API_KEY: CFG.livekit.key, LIVEKIT_API_SECRET: CFG.livekit.secret,
      LIVEKIT_ADMIN_URL: CFG.livekit.url.replace(/^ws/, 'http'),
      // No instance voice list: the LIVEKIT_URL above is the only media server.
      VOICE_SERVERS_FILE: path.join(instanceDir, 'none.json'), INSTANCE_DIR: instanceDir,
      CLIENT_ORIGIN: WEB, COOKIE_DOMAIN: 'localhost',
      // The limiter's own off switch: two browsers on one address sign in a lot.
      VITEST: '1',
      MUSIC_SERVICE_URL: '', CLAMD_HOST: '', CLIENT_DIR: '',
    })
    const webProc = startProcess('web', ['vite', '--port', String(CFG.web), '--strictPort', '--host', '127.0.0.1'], {
      API_PORT: String(CFG.relay),
    })
    if (!await waitFor(() => httpUp(`http://127.0.0.1:${CFG.api}/health`), 90_000, 500)) {
      throw new Error(`API did not come up:\n${apiProc.tail.join('\n')}`)
    }
    if (!await waitFor(() => httpUp(`http://127.0.0.1:${CFG.web}/`), 90_000, 500)) {
      throw new Error(`Vite did not come up:\n${webProc.tail.join('\n')}`)
    }

    // Two people who share a server and are friends (so A can call B).
    const tag = Date.now().toString(36)
    const mk = async (letter, display) => {
      const username = `e2e_${letter}_${tag}`
      const email = `${username}@e2e.test`
      const res = await api('/auth/register', { body: { username, email, password: 'E2ePass123!', displayName: display } })
      return { id: res.user.id, token: res.accessToken, email, password: 'E2ePass123!', name: display, letter }
    }
    const A = await mk('a', 'Ada E2E')
    const B = await mk('b', 'Bo E2E')
    const serverName = `Drops ${tag}`
    const made = await api('/servers', { token: A.token, body: { name: serverName } })
    const voiceId = made.channels.find(c => c.type === 'voice').id
    const room = `voice:${voiceId}`
    const db = mongoose.connection.db
    await db.collection('servers').updateOne({ _id: new mongoose.Types.ObjectId(made.server.id) },
      { $push: { members: new mongoose.Types.ObjectId(B.id) } })
    await db.collection('friendships').insertOne({
      requester: new mongoose.Types.ObjectId(A.id), receiver: new mongoose.Types.ObjectId(B.id),
      status: 'accepted', createdAt: new Date(), updatedAt: new Date(),
    })

    browser = await chromium.launch({
      headless: true,
      // E2E_CHROME_CHANNEL=chrome uses the installed Chrome (still headless)
      // instead of a browser Playwright downloaded.
      channel: process.env.E2E_CHROME_CHANNEL || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    })
    const probe = await browser.newContext()
    const baseUa = await (await probe.newPage()).evaluate(() => navigator.userAgent)
    await probe.close()
    const contextFor = who => browser.newContext({ userAgent: `${baseUa} SkycordE2E/${who.letter.toUpperCase()}`, permissions: ['microphone', 'camera'] })
    const ctxA = await contextFor(A), ctxB = await contextFor(B)
    const pageA = await ctxA.newPage(), pageB = await ctxB.newPage()
    await signIn(pageA, A)
    await signIn(pageB, B)
    await pageB.locator(`div.ri[role="button"][aria-label^="${serverName}"]`).click()

    /** B's list and rows agree with LiveKit about A, within `ms`. */
    const listMatchesRoom = async (label, ms = 25_000) => {
      const seen = await waitFor(async () => {
        const inRoom = (await roster(room)).includes(A.id)
        const b = await stateOf(pageB, room)
        const rows = await rowsOf(pageB)
        const listed = b.list.includes(A.id) && rows.filter(n => n === A.name).length === 1
        return inRoom && listed ? { inRoom, listed, rows } : null
      }, ms)
      const now = { inRoom: (await roster(room)).includes(A.id), list: (await stateOf(pageB, room)).list, rows: await rowsOf(pageB) }
      check(`${label}: A is in the room and in B's list`, !!seen,
        seen ? '' : `LiveKit has A: ${now.inRoom}; B's list: [${now.list}]; B's rows: [${now.rows}]`)
    }

    log('A joins the voice channel')
    await join(pageA, voiceId, 'channel', 'General')
    await waitFor(async () => (await stateOf(pageA, room)).inCall, 30_000)
    await listMatchesRoom('baseline')

    if (wanted('S1')) {
      log('S1: A\'s socket drops and comes back; LiveKit stays up')
      const t0 = Date.now()
      relay.heldClosed.length = 0
      check('S1: relay cut a socket', relay.cut('A') > 0)
      const back = await waitFor(async () => (await stateOf(pageA, room)).socket && Date.now(), 20_000)
      // The API notices the old socket only when its ping goes unanswered.
      const late = await waitFor(() => relay.heldClosed.find(h => h.tag === 'A'), 25_000)
      check('S1: the API dropped the old socket after the browser was back', !!(back && late && late.at > back),
        `back after ${back ? back - t0 : '?'} ms, old socket closed after ${late ? late.at - t0 : '?'} ms`)
      await sleep(1500)
      await listMatchesRoom('S1', 5_000)
    }

    if (wanted('S2')) {
      log('S2: LiveKit reconnects inside the SDK; the socket stays up')
      await simulate(pageA, 'full-reconnect')
      await sleep(8_000)
      await listMatchesRoom('S2')
    }

    if (wanted('S3')) {
      log('S3: LiveKit drops the room; the app rejoins; the socket stays up')
      await simulate(pageA, 'server-leave')
      await sleep(3_000)
      await waitFor(async () => (await stateOf(pageA, room)).inCall, 40_000)
      await listMatchesRoom('S3')
    }

    if (wanted('S4')) {
      log('S4: both drop at once')
      relay.cut('A')
      await simulate(pageA, 'server-leave').catch(() => {})
      await sleep(3_000)
      await waitFor(async () => { const a = await stateOf(pageA, room); return a.inCall && a.socket }, 45_000)
      await sleep(16_000)   // past the API's ping timeout for the held socket
      await listMatchesRoom('S4')
    }

    if (wanted('S5')) {
      log('S5: A in a DM call; A\'s socket down past the call-end grace period')
      await leave(pageA)
      await sleep(1_000)
      const dmRoom = `dm:${[A.id, B.id].sort().join('_')}`
      await join(pageA, B.id, 'dm', B.name)
      await waitFor(async () => (await stateOf(pageA, dmRoom)).inCall, 30_000)
      await waitFor(async () => (await stateOf(pageB, dmRoom)).list.includes(A.id), 10_000)
      relay.block('A')
      relay.cut('A')
      await sleep(35_000)   // 20 s grace + the API's 15 s ping timeout
      const ended = await db.collection('messages').countDocuments({ conversationId: [A.id, B.id].sort().join('_'), content: 'Call ended' })
      const stillIn = (await roster(dmRoom)).includes(A.id)
      check('S5: A is still in the DM call on LiveKit', stillIn)
      check('S5: no "Call ended" while A is still in the call', ended === 0, `${ended} written`)
      const bList = (await stateOf(pageB, dmRoom)).list
      check('S5: B still sees A in the call while A\'s socket is down', bList.includes(A.id), `B's list: [${bList}]`)
      relay.unblock('A')
      await waitFor(async () => (await stateOf(pageA, dmRoom)).socket, 60_000)
      const bBack = await waitFor(async () => (await stateOf(pageB, dmRoom)).list.includes(A.id), 20_000)
      check('S5: B sees A once A is back', !!bBack)
      await leave(pageA)
      const endedCount = () => db.collection('messages').countDocuments({ conversationId: [A.id, B.id].sort().join('_'), content: 'Call ended' })
      await waitFor(async () => (await endedCount()) >= 1, 10_000)
      await sleep(1_500)
      const endedTotal = await endedCount()
      check('S5: the call ends once, when A hangs up', endedTotal === 1, `${endedTotal} "Call ended" in the DM`)
      await join(pageA, voiceId, 'channel', 'General')
      await waitFor(async () => (await stateOf(pageA, room)).inCall, 30_000)
    }

    if (wanted('S6')) {
      log('S6: A joins the same channel from a second tab')
      const pageA2 = await ctxA.newPage()
      await pageA2.goto(WEB)
      await waitFor(() => pageA2.evaluate(async () => (await import('/src/composables/useSocket.ts')).connected.value).catch(() => false), 30_000)
      await join(pageA2, voiceId, 'channel', 'General')
      await sleep(4_000)
      // Watch both tabs for ten seconds: one call, held, and no flip-flopping.
      const samples = []
      for (let i = 0; i < 20; i++) {
        samples.push([(await stateOf(pageA, room)).inCall, (await stateOf(pageA2, room)).inCall])
        await sleep(500)
      }
      const flips = samples.slice(1).filter((s, i) => s[0] !== samples[i][0] || s[1] !== samples[i][1]).length
      const last = samples[samples.length - 1]
      const trace = samples.map(s => (s[0] ? '1' : '-') + (s[1] ? '2' : '-')).join(' ')
      check('S6: the second tab holds the call and the first has left it', last[0] === false && last[1] === true,
        `first tab in call: ${last[0]}, second: ${last[1]}; LiveKit has A ${(await roster(room)).filter(id => id === A.id).length}x; samples: ${trace}`)
      check('S6: the two tabs do not take the call from each other', flips === 0, `${flips} changes in 10 s`)
      await listMatchesRoom('S6')
      await pageA2.close()
    }
  } finally {
    await browser?.close().catch(() => {})
    relay.stop()
    stopProcesses()
    await mongoose.disconnect().catch(() => {})
  }
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(err => {
  console.error(err)
  stopProcesses()
  process.exit(1)
})
