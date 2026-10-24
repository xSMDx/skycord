/**
 * The Android app's notifications, replies, calls and catch-up, end to end, on
 * the emulator, against the local dev stack. It walks the spec's list
 * (docs/superpowers/specs/2026-10-23-android-notifications-design.md, "Tests")
 * in order: a DM notifies and its tap opens the chat; a reply sent from the
 * notification arrives; five quick messages are one notification and one alert;
 * a muted conversation is silent; a mention notifies and a plain channel
 * message does not; a call rings full screen, Decline tells the caller, a call
 * left to ring out is a missed call, a reconnect into a call already going does
 * not ring, Answer joins; a force-stopped app catches up silently and shows
 * offline to a friend; and after a reboot the app reconnects on its own.
 *
 * Run it from a shell where the toolchain is on PATH:
 *
 *   source android/env.sh
 *   node android/e2e/notify.e2e.mjs
 *
 * Needs (it checks the first five and refuses to run without them):
 *  - `adb` on PATH (that is what `source android/env.sh` does);
 *  - exactly one running emulator, e.g.
 *      emulator -avd skycord35 -ports 6554,6555 -no-snapshot -no-audio
 *    With several emulators running, say which one with `ANDROID_SERIAL`
 *    (`ANDROID_SERIAL=emulator-6556 node android/e2e/notify.e2e.mjs`): that
 *    one only, and every adb command names it, so no other device is touched.
 *    A real phone is refused: the script wipes the app's data, force-stops it
 *    and reboots the device;
 *  - the debug APK installed (`cd android && ./gradlew assembleDebug`, then
 *    `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`);
 *  - the dev client on port 6200, started in this worktree with
 *      npx vite --host 0.0.0.0 --port 6200 --strictPort
 *    (its proxy goes to the API on the port in `.env` `API_PORT`, 3200 here);
 *  - the dev API on port 3200: `node .dev/desk-api.mjs` from H:\projects\sykord-wt;
 *  - for the call that is answered, the media server (Docker `livekit-server`)
 *    up, as for any call in the dev client.
 *
 * What it does to the machine: it runs `adb reverse` for 6200 (the client, as
 * http://localhost:6200), 7880 and 7881 (the media server) and leaves them in
 * place (a reboot loses them; it puts them back at once); `pm clear`s the app
 * (all its saved servers and sign-ins are gone), grants it the notification,
 * microphone and camera permissions and the full-screen-call switch, and signs
 * a throwaway account in to it; presses Home, locks and wakes the screen
 * (dismissing the keyguard), opens the notification shade and taps in it;
 * turns the emulator's wifi off for a few seconds and back on (a change of
 * network, which makes the app connect again); force-stops the app; and
 * finally **reboots the emulator**,
 * leaving the app signed in and its background connection running. On the local
 * dev API it registers two throwaway accounts (the phone's and a friend's, who
 * is made a friend of the first) and a server they share; they stay in the
 * local dev database. Nothing here touches a real server. Every message it
 * sends is tagged `e2e-` and comes from the friend.
 *
 * Reads notifications with `adb shell dumpsys notification --noredact`, the
 * alerts the system really made from the events log (`notification_alert`, one
 * line each time a notification buzzes or beeps), and the screen with the
 * stock uiautomator.
 *
 * The dev API pins its sign-in cookie to `localhost`, and `/auth/register` and
 * `/auth/login` share a limit of 10 per address per 15 minutes: one run uses
 * three (the two registrations and the phone's sign-in); later tokens for the
 * two accounts are got from the cookie their registration set.
 */
import { createRequire } from 'module'
import { execSync, execFileSync } from 'child_process'

// The number of checks below. A run that makes fewer or more has lost or grown
// a check by accident, and fails.
const EXPECTED = 25

try { execSync('adb version', { stdio: 'pipe' }) } catch {
  console.error('adb is not on PATH: run `source android/env.sh` first')
  process.exit(1)
}

const need = createRequire(new URL('../../desktop/package.json', import.meta.url))
const { _android } = need('playwright-core')
const { io } = need('socket.io-client')

const PKG = 'xyz.skycord.android'
const API = 'http://127.0.0.1:3200'
const CLIENT = 'http://localhost:6200'
const results = []
const failed = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) failed.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  \u2014 ' + detail : ''}`)
}
const step = text => console.log(`\n\u2500\u2500 ${text}`)
const wait = ms => new Promise(r => setTimeout(r, ms))
// Look until `fn` is true (a throw counts as "not yet"), up to `ms`; its last value comes back.
const until = async (fn, ms = 5000, every = 300) => {
  const end = Date.now() + ms
  let v
  do {
    try { v = await fn(); if (v) return v } catch { /* look again */ }
    await wait(every)
  } while (Date.now() < end)
  return v || false
}

// ── what the script needs to be running, before it touches anything ──────
const up = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok } catch { return false } }
if (!(await up(`${API}/instance`))) {
  console.error(`the dev API is not answering on ${API}: start it with \`node .dev/desk-api.mjs\` from H:\\projects\\sykord-wt`)
  process.exit(1)
}
if (!(await up(`${CLIENT}/instance`))) {
  console.error(`the dev client is not answering on ${CLIENT}: start it with \`npx vite --host 0.0.0.0 --port 6200 --strictPort\``)
  process.exit(1)
}

// ── the device ───────────────────────────────────────────────────────────
// Only an emulator: the script clears the app's data and reboots the device.
const devices = await _android.devices()
const wanted = process.env.ANDROID_SERIAL
const emulators = devices.filter(d => d.serial().startsWith('emulator-'))
if (wanted && !wanted.startsWith('emulator-')) {
  console.error(`ANDROID_SERIAL=${wanted} is not an emulator: a real device is refused (the script wipes the app's data and reboots it)`)
  process.exit(1)
}
if (wanted ? !emulators.some(d => d.serial() === wanted) : emulators.length !== 1) {
  console.error(wanted
    ? `ANDROID_SERIAL=${wanted} is not a running emulator (running: ${emulators.map(d => d.serial()).join(', ') || 'none'})`
    : emulators.length === 0
      ? `no emulator${devices.length ? ` (a real device is refused: ${devices.map(d => d.serial()).join(', ')})` : ''}: start one with \`emulator -avd skycord35 -ports 6554,6555\``
      : `more than one emulator is running (${emulators.map(d => d.serial()).join(', ')}): leave just one, or name one with ANDROID_SERIAL`)
  process.exit(1)
}
const device = wanted ? emulators.find(d => d.serial() === wanted) : emulators[0]
const serial = device.serial()
// Plain adb, not Playwright's: the device is rebooted at the end, and only the WebView needs Playwright.
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { stdio: 'pipe', maxBuffer: 64 << 20, timeout: 90000 }).toString()
const sh = cmd => adb('shell', cmd)
if (!sh(`pm list packages ${PKG}`).includes(`package:${PKG}`)) {
  console.error('the debug APK is not installed: `cd android && ./gradlew assembleDebug`, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`')
  process.exit(1)
}
const reverseAll = () => { for (const p of [6200, 7880, 7881]) adb('reverse', `tcp:${p}`, `tcp:${p}`) }
reverseAll()

const focus = () => sh('dumpsys window | grep mCurrentFocus').trim()
const inFront = () => focus().includes(PKG)
// Home. The app is only "away" once Android has stopped its activity, a moment after it loses the
// focus; a message that arrives before that is the page's to show, and is not shown again.
const home = async () => { sh('input keyevent 3'); await until(() => !inFront(), 5000, 200); await wait(2000) }
const launch = async () => { sh(`am start -n ${PKG}/.MainActivity`); await until(inFront, 8000, 200) }
// The launcher (the server list) instead of the last server's page: no web client is up, so the page
// is not "in front" and the phone notifies as usual (the web client is what makes the app quiet).
const launchServerList = async () => {
  sh(`am start -n ${PKG}/.MainActivity -a xyz.skycord.android.action.CHOOSE_SERVER`)
  await until(inFront, 8000, 200)
}
// The screen awake and the keyguard gone, as a person who picked the phone up would have it.
const wake = async () => {
  sh('input keyevent 224')
  await wait(400)
  sh('wm dismiss-keyguard')
  await wait(600)
}
const sleepScreen = async () => { sh('input keyevent 223'); await wait(1200) }

// What is on the phone's screen, read with the stock uiautomator. The old dump is removed first, and a
// dump that did not happen throws, so a stale or missing file is never read as the current screen.
const screenNodes = () => {
  sh('rm -f /sdcard/e2e-ui.xml; uiautomator dump /sdcard/e2e-ui.xml')
  const xml = sh('cat /sdcard/e2e-ui.xml')
  if (!xml.includes('<hierarchy')) throw new Error('no screen dump')
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => Object.fromEntries([...n.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])))
}
const nodeText = n => `${n.text ?? ''}\n${n['content-desc'] ?? ''}`
const findOnScreen = (pred, ms = 8000) => until(() => screenNodes().find(pred), ms, 400)
const centre = n => { const [x1, y1, x2, y2] = n.bounds.match(/\d+/g).map(Number); return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)] }
const tapNode = n => { const [x, y] = centre(n); sh(`input tap ${x} ${y}`) }
const tapText = async (text, ms) => {
  const n = await findOnScreen(n => n.text === text || n['content-desc'] === text, ms)
  if (!n) throw new Error(`nothing on screen says "${text}"`)
  tapNode(n)
}

// ── notifications, as the system lists them ──────────────────────────────
// Our package's notifications from dumpsys: one record each, with what the checks look at.
const notices = () => {
  const out = sh('dumpsys notification --noredact')
  return out.split(/\n(?=\s+NotificationRecord\()/).filter(b => b.includes(`pkg=${PKG} `)).map(b => {
    const head = b.split('\n', 1)[0]
    const one = re => (b.match(re) || [])[1]
    return {
      id: one(/\bid=(\d+) tag=/),
      tag: one(/\btag=(\S+) importance=/),
      channel: one(/channel=(\w+)/),
      category: one(/ category=(\w+)/),
      flags: (one(/\n\s+flags=(\S+)/) ?? '').split('|'),
      // The system puts a quiet notification in its own silent section (`groupKey=silent` in the toString).
      silentSection: /groupKey=silent/.test(head),
      title: one(/android\.title=String \((.*)\)\s*\n/),
      subText: one(/android\.subText=String \((.*)\)\s*\n/),
      template: one(/android\.template=String \((.*)\)\s*\n/),
      actions: [...b.matchAll(/\n\s+\[\d+\] "([^"]*)" ->/g)].map(m => m[1]),
      fullScreen: !/fullscreenIntent=null/.test(b),
      // MessagingStyle lines, oldest first; the person's own are "You".
      lines: [...b.matchAll(/\[\d+\] Bundle\[\{[^\n]*?sender=(.*?), text=(.*?), time=\d+\}\]/g)].map(m => ({ from: m[1], text: m[2] })),
    }
  })
}
const SERVICE_ID = '1003'
const RING_ID = '1004'
const MISSED_ID = '1005'
const noticeFor = (tag, text) => notices().find(n => n.id === '1001' && n.tag === tag && (!text || n.lines.some(l => l.text === text)))
const serviceNotice = () => notices().find(n => n.id === SERVICE_ID)
const connected = () => /^Connected to /.test(serviceNotice()?.title ?? '')
const ringNotice = () => notices().find(n => n.id === RING_ID)
const missedNotice = tag => notices().find(n => n.id === MISSED_ID && n.tag === tag)
const quiet = n => n.flags.includes('ONLY_ALERT_ONCE')

// What the system did, not what was asked of it. Each notification that buzzes or beeps puts one line
// in the events log; each post of one puts another. Clear the log, act, then count.
const clearEvents = () => sh('logcat -b events -c')
const eventLines = name => sh(`logcat -b events -d -v brief -s ${name}`).split(/\r?\n/).filter(l => l.includes(`${name}(`))
// An alert names the notification by its key (user|package|id|tag|uid); a post lists package, id and tag.
const alertsFor = tag => eventLines('notification_alert').filter(l => l.includes(`|${PKG}|1001|${tag}|`)).length
const postsFor = tag => eventLines('notification_enqueue').filter(l => l.includes(`,${PKG},1001,${tag},`)).length
// How many times the service has connected (its own log line), to know that a reconnect really happened.
const connects = () => sh('logcat -d -v brief -s LiveConnection:I').split(/\r?\n/).filter(l => /LiveConnection.*: connected\s*$/.test(l)).length
// ...and how many times it noticed the phone's network change and started over.
const networkChanges = () => sh('logcat -d -v brief -s NotifyService:I').split(/\r?\n/).filter(l => l.includes('the network changed')).length

// ── the notification shade ───────────────────────────────────────────────
const openShade = async () => { await wake(); sh('cmd statusbar expand-notifications'); await wait(1300) }
const closeShade = () => sh('cmd statusbar collapse')
const tapNoticeLine = async text => {
  await openShade()
  const n = await findOnScreen(n => nodeText(n).includes(text))
  if (!n) throw new Error(`no notification in the shade says "${text}"`)
  tapNode(n)
}
// Types `reply` into the reply field of the notification showing `text`, and sends it.
const replyFromShade = async (text, reply) => {
  await openShade()
  let button = await findOnScreen(n => nodeText(n).split('\n').includes('Reply'), 4000)
  if (!button) {
    // Collapsed among others: open the one that shows `text` first.
    const line = await findOnScreen(n => nodeText(n).includes(text))
    if (!line) throw new Error(`no notification in the shade says "${text}"`)
    const [, ly1, , ly2] = line.bounds.match(/\d+/g).map(Number)
    const expand = await findOnScreen(n => {
      if (n['content-desc'] !== 'Expand') return false
      const [, y1, , y2] = n.bounds.match(/\d+/g).map(Number)
      return y1 <= ly1 && y2 >= ly2
    })
    if (expand) { tapNode(expand); await wait(900) }
    button = await findOnScreen(n => nodeText(n).split('\n').includes('Reply'))
  }
  if (!button) throw new Error('no Reply button on the notification')
  tapNode(button)
  await wait(900)
  sh(`input text ${reply}`)   // one word, no spaces to escape
  await wait(400)
  const send = await findOnScreen(n => /send/i.test(n['content-desc'] ?? '') || (n['resource-id'] ?? '').endsWith('remote_input_send'))
  if (!send) throw new Error('no send button in the reply field')
  tapNode(send)
  await wait(1500)
  closeShade()
}

// ── two throwaway accounts, a friendship and a server, on the local dev API ──
// The password satisfies server/utils/validators.ts (no hyphen: it is not in the accepted set of special characters).
const tag = Date.now().toString(36)
const A = { key: 'A', username: `droid_${tag}`, email: `droid_${tag}@example.com`, password: `Droid!${tag}A1`, displayName: 'Droid' }
const B = { key: 'B', username: `bea_${tag}`, email: `bea_${tag}@example.com`, password: `Droid!${tag}A1`, displayName: 'Bea' }
const json = async (r, what) => {
  if (!r.ok) throw new Error(`${what}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const register = async u => {
  const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.username, email: u.email, password: u.password, displayName: u.displayName }) })
  const body = await json(r, `register ${u.key}`)
  u.id = body.user.id
  u.token = body.accessToken
  u.tokenAt = Date.now()
  // The refresh cookie the registration set: a new access token later costs no sign-in (which is rate-limited).
  u.cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}
const tokenOf = async u => {
  if (Date.now() - u.tokenAt < 10 * 60_000) return u.token
  const r = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { cookie: u.cookie } })
  u.token = (await json(r, `refresh ${u.key}`)).accessToken
  u.tokenAt = Date.now()
  return u.token
}
const call = async (u, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(u)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return json(r, `${method} ${path}`)
}
const dm = (text, from = B, to = A) => call(from, 'POST', `/messages/dm/${to.id}`, { content: text })
const burstOfDms = async (n, prefix) => { for (let i = 1; i <= n; i++) { await dm(`${prefix}-${i}`); await wait(120) } }
const statusOfA = async () => {
  const { friends } = await call(B, 'GET', '/users/friends')
  return friends.find(f => (f.id ?? f._id) === A.id)?.status
}

step('two accounts, a friendship, a server')
await register(A)
await register(B)
await call(B, 'POST', '/users/friends/request', { targetId: A.id })
const { requests } = await call(A, 'GET', '/users/friends/pending')
const pending = requests.find(r => JSON.stringify(r).includes(B.id))
await call(A, 'PATCH', `/users/friends/accept/${pending.id ?? pending._id}`, {})
const serverName = `Notify E2E ${tag}`
const created = await call(B, 'POST', '/servers', { name: serverName })
const serverId = created.server.id
const generalId = created.channels.find(c => c.type === 'text').id
const invite = await call(B, 'POST', `/servers/${serverId}/invites`, {})
await call(A, 'POST', `/invites/${invite.invite.code}`, {})

// The friend's own connection, as the web client has one: it hears the call's occupancy and a decline.
const heard = []
const friend = io(API, { auth: { token: await tokenOf(B) }, transports: ['websocket'] })
friend.on('call:state', p => heard.push({ name: 'call:state', p }))
friend.on('call:declined', p => heard.push({ name: 'call:declined', p }))
await new Promise((ok, no) => { friend.on('connect', ok); friend.on('connect_error', e => no(new Error(`the friend's socket: ${e.message}`))) })
const callWith = { conversationId: A.id, kind: 'dm' }
const startCall = () => friend.emit('call:join', callWith)
const endCall = async () => {
  friend.emit('call:leave', callWith)
  // Over when the room has emptied: the next call is a new one, with a new start.
  await until(() => heard.some((h, i) => i >= mark && h.name === 'call:state' && h.p.userIds.length === 0), 6000, 200)
}
let mark = 0
const heardSince = (name, pred = () => true) => heard.slice(mark).filter(h => h.name === name && pred(h.p))

// ── a fresh app, signed in ───────────────────────────────────────────────
const pageOf = async urlPart => {
  for (let i = 0; i < 40; i++) {
    for (const wv of device.webViews()) {
      if (wv.pkg() !== PKG) continue
      const p = await wv.page()
      if (p.url().includes(urlPart)) return p
    }
    await wait(500)
  }
  throw new Error(`no WebView page at ${urlPart}`)
}

step('a fresh app, signed in as the phone\u2019s account')
sh(`pm clear ${PKG}`)
for (const p of ['POST_NOTIFICATIONS', 'RECORD_AUDIO', 'CAMERA']) sh(`pm grant ${PKG} android.permission.${p}`)
sh(`appops set ${PKG} USE_FULL_SCREEN_INTENT allow`)
await wake()
await launch()
await wait(1500)
const launcher = await pageOf('appassets.androidplatform.net')
await launcher.waitForSelector('#address')
await launcher.fill('#address', CLIENT)
await launcher.click('#check')
await launcher.waitForSelector('#found:not([hidden])', { timeout: 15000 })
await launcher.click('#found-open')
const app = await pageOf('localhost:6200')
await app.waitForSelector('#login-identifier', { timeout: 30000 })
await app.fill('#login-identifier', A.username)
await app.fill('#login-password', A.password)
await app.getByRole('button', { name: 'Sign In', exact: true }).click()
check('the phone\u2019s account signs in', await until(async () => await app.evaluate(() => !!document.querySelector('.ri.home') && !document.querySelector('#login-identifier')), 40000, 500))
// The first-run question about battery limits: not now (it is asked once, and is not what this tests).
const notNow = await findOnScreen(n => n.text === 'Not now', 6000)
if (notNow) tapNode(notNow)
await wait(800)

step('the app is left: the background connection comes up')
await home()
check('leaving the app starts the background connection', await until(connected, 30000, 500), `service notice: ${serviceNotice()?.title}`)

// A phase that fails (a thrown error: nothing on the screen, no page) is reported and the next one still
// runs, so one run shows everything that is wrong; the checks it did not get to make count as missing.
const phase = async (name, fn) => {
  step(name)
  try { await fn() } catch (e) {
    failed.push(`${name}: ${e.message}`)
    console.log(`FAIL  ${name}  — ${e.message}`)
  } finally {
    try { closeShade() } catch { /* nothing to close */ }
  }
}
const dmTag = `dm:${B.id}`
const chanTag = `channel:${generalId}`

// ── 1. a DM becomes a notification ───────────────────────────────────────
await phase('a DM from a friend', async () => {
  clearEvents()
  await dm('e2e-dm-1')
  const first = await until(() => noticeFor(dmTag, 'e2e-dm-1'), 10000, 400)
  await wait(1200)   // the system logs the alert a moment after the notification shows
  check('a DM becomes a notification: the sender’s name, the message, a sound, a Reply button',
    !!first && first.channel === 'messages' && first.category === 'msg' && first.title === 'Bea' && !quiet(first)
      && first.actions.includes('Reply') && alertsFor(dmTag) === 1,
    first ? `${first.channel}/${first.category}, title "${first.title}", flags ${first.flags.join('|')}, alerts ${alertsFor(dmTag)}` : 'no notification')
})

// ── 2. tapping it opens the DM ───────────────────────────────────────────
await phase('tap it', async () => {
  await tapNoticeLine('e2e-dm-1')
  const opened = await until(inFront, 10000, 300)
  const shown = opened && await until(async () => await app.evaluate(t => {
    const chat = document.querySelector('.shell.m-chat')
    return !!chat && chat.innerText.includes('Bea') && chat.innerText.includes(t)
  }, 'e2e-dm-1'), 15000, 500)
  check('tapping the notification opens that DM in the app, and the notification goes', !!shown && !noticeFor(dmTag),
    `app in front: ${opened}; chat shown: ${!!shown}; notification gone: ${!noticeFor(dmTag)}`)
})

// ── 3. a reply from the notification arrives ─────────────────────────────
await phase('reply from the notification', async () => {
  await home()
  await dm('e2e-dm-2')
  if (!(await until(() => noticeFor(dmTag, 'e2e-dm-2'), 10000, 400))) throw new Error('the DM to reply to never notified')
  const reply = 'e2e-reply-1'
  await replyFromShade('e2e-dm-2', reply)
  const arrived = await until(async () => (await call(B, 'GET', `/messages/dm/${A.id}`)).messages.some(m => m.authorId === A.id && m.content === reply), 10000, 500)
  check('a reply typed into the notification reaches the friend', !!arrived)
  const afterReply = await until(() => noticeFor(dmTag, reply), 8000, 400)
  check('…and joins the notification as the person’s own line, once, quietly',
    !!afterReply && afterReply.lines.at(-1)?.from === 'You' && afterReply.lines.filter(l => l.text === reply).length === 1
      && afterReply.lines.length === 2 && quiet(afterReply),
    afterReply ? `lines: ${afterReply.lines.map(l => `${l.from}: ${l.text}`).join(' / ')}; flags ${afterReply.flags.join('|')}` : 'the notification is gone')
})

// ── 4. five quick messages: one notification, one alert ──────────────────
await phase('five quick messages', async () => {
  clearEvents()
  await burstOfDms(5, 'e2e-burst')
  const five = await until(() => noticeFor(dmTag, 'e2e-burst-5'), 10000, 400)
  await wait(1500)
  const burst = notices().filter(n => n.id === '1001' && n.tag === dmTag)
  check('five quick messages are one notification holding all five',
    burst.length === 1 && [1, 2, 3, 4, 5].every(i => burst[0].lines.some(l => l.text === `e2e-burst-${i}`)),
    `${burst.length} notification(s); lines: ${burst[0]?.lines.map(l => l.text).join(', ')}`)
  check('…and only the first of them makes a sound', !!five && alertsFor(dmTag) === 1 && !!burst[0] && quiet(burst[0]),
    `alerts: ${alertsFor(dmTag)}; last post quiet: ${burst[0] ? quiet(burst[0]) : 'no notification'}`)
})

// ── 5. muted: nothing ────────────────────────────────────────────────────
// A mute is written by the page (the server keeps it per person), which then tells the app to read the
// mutes again (`prefsChanged`): so does this.
await phase('mute the conversation', async () => {
  const prefsChanged = async () => {
    try { await app.evaluate(() => window.skycordAndroid.prefsChanged()) } catch {
      // A page the system has put to sleep with the app: wake it, tell it, and leave again.
      await launch(); await app.evaluate(() => window.skycordAndroid.prefsChanged()); await home()
    }
    await wait(2500)
  }
  await call(A, 'PATCH', `/users/me/conversations/${B.id}`, { mute: 'forever' })
  await prefsChanged()
  clearEvents()
  await dm('e2e-muted-1')
  await wait(4000)
  check('a muted conversation posts nothing', postsFor(dmTag) === 0 && !noticeFor(dmTag, 'e2e-muted-1'), `posts: ${postsFor(dmTag)}`)
  await call(A, 'PATCH', `/users/me/conversations/${B.id}`, { mute: null })
  await prefsChanged()
  await dm('e2e-unmuted-1')
  check('…and unmuting brings the notifications back', !!(await until(() => noticeFor(dmTag, 'e2e-unmuted-1'), 10000, 400)))
})

// ── 6. a mention notifies; a plain channel message does not ──────────────
await phase('a channel: a plain message, then a mention', async () => {
  const say = text => call(B, 'POST', `/servers/${serverId}/channels/${generalId}/messages`, { content: text })
  clearEvents()
  await say('e2e-chan-plain')
  await wait(4000)
  check('a plain channel message at the default level posts nothing', postsFor(chanTag) === 0 && !notices().some(n => n.tag === chanTag), `posts: ${postsFor(chanTag)}`)
  await say(`<@${A.username}> e2e-chan-mention`)
  const mention = await until(() => notices().find(n => n.id === '1001' && n.tag === chanTag), 10000, 400)
  await wait(1200)
  // The notification's title is Android's own for a named conversation: "conversation: sender".
  check('a mention in a channel notifies, saying where and that it mentions you',
    !!mention && mention.title === `#general · ${serverName}: Bea` && mention.subText === 'Mentioned you'
      && mention.lines.some(l => l.text.includes('e2e-chan-mention')) && !quiet(mention) && alertsFor(chanTag) === 1,
    mention ? `title "${mention.title}", sub "${mention.subText}", alerts ${alertsFor(chanTag)}` : 'no notification')
})

// ── 7. a call: it rings full screen; Decline tells the caller ────────────
await phase('a call, with the phone asleep: it rings full screen', async () => {
  await sleepScreen()
  mark = heard.length
  startCall()
  const ring = await until(ringNotice, 15000, 400)
  const onCallScreen = await until(() => focus().includes('IncomingCallActivity'), 10000, 300)
  check('a DM call rings as a call notification, with Decline and Answer, on the Calls channel',
    !!ring && ring.channel === 'calls' && ring.category === 'call' && ring.flags.includes('INSISTENT')
      && ring.actions.includes('Decline') && ring.actions.includes('Answer') && ring.fullScreen,
    ring ? `${ring.channel}/${ring.category}, flags ${ring.flags.join('|')}, template ${ring.template}, actions ${ring.actions.join('/')}, full screen ${ring.fullScreen}` : 'no ring')
  const hasButtons = onCallScreen && !!(await findOnScreen(n => n.text === 'Incoming call', 6000))
    && !!(await findOnScreen(n => n['content-desc'] === 'Answer', 3000)) && !!(await findOnScreen(n => n['content-desc'] === 'Decline', 3000))
  check('…and the call screen takes the phone, with Answer and Decline',
    onCallScreen && hasButtons, `call screen in front: ${onCallScreen}; “Incoming call” and both buttons: ${hasButtons}`)
  // The ring and the call screen name the caller as the friend's own messages do (their display name),
  // not by the account's username.
  const onScreenName = onCallScreen ? !!(await findOnScreen(n => n.text === B.displayName, 3000)) : false
  check('the ring and the call screen name the caller by display name, as the friend’s messages do',
    !!ring && ring.title === B.displayName && onScreenName,
    `ring title "${ring?.title}"; call screen shows "${B.displayName}": ${onScreenName}`)
  if (hasButtons) await tapText('Decline')
  const declined = await until(() => heardSince('call:declined')[0], 10000, 300)
  await until(() => !ringNotice() && !focus().includes('IncomingCallActivity'), 8000, 300)
  check('Decline tells the caller who declined, and ends the ring',
    !!declined && declined.p.userId === A.id && declined.p.name === 'Droid' && !ringNotice() && !focus().includes('IncomingCallActivity'),
    declined ? `declined by ${declined.p.name}` : 'the caller heard nothing')
  await wake()
  await endCall()
})

// ── 8. a call that rings out is a missed call; a reconnect does not ring ──
await phase('a call nobody answers', async () => {
  mark = heard.length
  startCall()
  const rang = await until(ringNotice, 15000, 400)
  const rangAt = Date.now()
  const missed = await until(() => missedNotice(`missed:${dmTag}`), 45000, 1000)
  check('a call left to ring out is a missed call from the caller, and the ring is gone',
    !!rang && !!missed && /^Missed call from /.test(missed.title) && missed.channel === 'messages' && !ringNotice(),
    `rang: ${!!rang}; missed call: ${missed ? `"${missed.title}" after ${Math.round((Date.now() - rangAt) / 1000)} s` : 'none'}; ring gone: ${!ringNotice()}`)
  check('…and it names the caller by display name', missed?.title === `Missed call from ${B.displayName}`, `title "${missed?.title}"`)
})

await phase('the network changes during that call', async () => {
  // The call is still going (the caller has not hung up) and is older than the ring's 30 s. A change of
  // network (wifi off, mobile on, wifi back) makes the app connect again; the server then replays the
  // call's state to it, and the app must not ring for it.
  const connectsBefore = connects()
  const changesBefore = networkChanges()
  sh('svc wifi disable')
  await wait(3000)
  sh('svc wifi enable')
  const reconnected = await until(() => connects() > connectsBefore && networkChanges() > changesBefore, 40000, 500)
  const settled = await until(connected, 30000, 500)
  await wait(6000)   // the server replays the call's state right after the connect
  check('a reconnect into a call already going does not ring',
    reconnected && settled && !ringNotice(),
    `connects ${connectsBefore} → ${connects()}; network changes ${changesBefore} → ${networkChanges()}; connected again: ${settled}; ring: ${!!ringNotice()}`)
  await endCall()
})

// ── 9. Answer joins ──────────────────────────────────────────────────────
await phase('a call that is answered', async () => {
  mark = heard.length
  startCall()
  if (!(await until(ringNotice, 15000, 400))) throw new Error('the call never rang')
  await openShade()
  const answer = await findOnScreen(n => nodeText(n).split('\n').includes('Answer'))
  if (answer) tapNode(answer)
  const inApp = await until(inFront, 15000, 300)
  const joined = await until(() => heardSince('call:state', p => p.userIds.includes(A.id) && p.userIds.includes(B.id))[0], 30000, 500)
  await wait(1000)
  check('Answer opens the app and joins the call',
    !!answer && inApp && !!joined && !ringNotice() && !missedNotice(`missed:${dmTag}`),
    `Answer on the ring: ${!!answer}; app in front: ${inApp}; the caller sees the phone’s account in the call: ${!!joined}; ring gone: ${!ringNotice()}`)
})

// ── 10. the app is killed: catch-up, silently; offline to a friend ───────
await phase('the app is force-stopped and a DM arrives', async () => {
  const onlineBefore = await statusOfA()
  sh(`am force-stop ${PKG}`)
  await endCall()
  await wait(1000)
  await dm('e2e-away-1')
  clearEvents()
  // With nothing of the app on screen but the server list, the page is not "in front": the service starts and catches up.
  await wake()
  await launchServerList()
  const caught = await until(() => noticeFor(dmTag, 'e2e-away-1'), 40000, 500)
  check('after the app was force-stopped, the DM sent meanwhile is shown once the connection is back', !!caught,
    caught ? `lines: ${caught.lines.map(l => l.text).join(', ')}` : 'no notification')
  await wait(1500)
  check('…and it is shown without a sound', !!caught && quiet(caught) && caught.silentSection && alertsFor(dmTag) === 0,
    caught ? `flags ${caught.flags.join('|')}, silent section: ${caught.silentSection}, alerts ${alertsFor(dmTag)}` : 'no notification')
  const serviceUp = await until(connected, 20000, 500)
  const offline = await until(async () => (await statusOfA()) === 'offline', 20000, 700)
  check('the account shows offline to a friend while only the background connection is up',
    onlineBefore !== 'offline' && serviceUp && !!offline,
    `with the app open: ${onlineBefore}; background connection up: ${serviceUp}; now: ${await statusOfA()}`)
})

// ── 11. reboot: the connection comes back on its own ─────────────────────
await phase('reboot the emulator', async () => {
  await device.close()
  adb('reboot')
  // Wait for the old system to be gone, then for the new one: the old one still answers for a moment.
  await until(() => !execSync('adb devices', { stdio: 'pipe' }).toString().includes(`${serial}\tdevice`), 60000, 500)
  adb('wait-for-device')
  const booted = await until(() => sh('getprop sys.boot_completed').trim() === '1', 240000, 2000)
  // The reverse is lost with the reboot; the service backs off until the server can be reached.
  reverseAll()
  const reconnected = await until(connected, 150000, 1500)
  // The app's own boot receiver started it (this boot's log), and nobody opened the app.
  const startedAtBoot = sh('logcat -d -v brief -s BootReceiver:I').includes('BOOT_COMPLETED: starting the background connection')
  check('after a reboot the app reconnects without being opened',
    booted && startedAtBoot && reconnected && !inFront(),
    `booted: ${booted}; started by the boot receiver: ${startedAtBoot}; connected: ${reconnected}; app in front: ${inFront()}`)
  clearEvents()
  await dm('e2e-boot-1')
  check('…and a DM then notifies', !!(await until(() => noticeFor(dmTag, 'e2e-boot-1'), 30000, 500)))
})

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} passed`)
if (failed.length) console.log(`failed: ${failed.join('; ')}`)
if (results.length !== EXPECTED) console.log(`FAIL  expected ${EXPECTED} checks, ran ${results.length}`)
friend.close()
process.exit(results.every(Boolean) && results.length === EXPECTED && !failed.length ? 0 : 1)
