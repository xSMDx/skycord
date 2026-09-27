// Samples the packaged app's memory through a scripted session.
// Local dev stack only: it refuses any origin that is not localhost.
//
// Session shape: launch the shell against a scratch profile pointed at the
// dev stack, sign in, open every channel the account's one server has
// (general text channel, then the voice channel — clicking a voice row
// joins the call the same way a member's click would), scroll each text
// channel's history back a little, then sit idle for 20 minutes while
// 10-second ticks keep sampling. The idle phase is the point: it is what
// shows whether memory grows with time rather than just with activity.
import { createRequire } from 'module'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import { join } from 'path'
const { _electron } = createRequire('H:/projects/sykord-wt/desktop/desktop/package.json')('playwright')

const env = Object.fromEntries(readFileSync(new URL('./.probe.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const origin = env.PROBE_ORIGIN || ''
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  console.error('PROBE_ORIGIN must be the local dev stack, not a live server.'); process.exit(1)
}
const label = (process.argv[process.argv.indexOf('--label') + 1] || 'run').replace(/[^a-z0-9-]/gi, '')
const wait = ms => new Promise(r => setTimeout(r, ms))

/**
 * Which performance level to measure. The level lives in two places and both
 * have to be set before the thing they control runs: the page's own
 * localStorage, read when the client boots, and the shell's skycord.json, read
 * before Chromium starts (the graphics card, the heap ceiling and the title bar
 * cannot change after that). A cold profile has neither, so the run seeds both.
 */
const LEVELS = {
  max:      { page: { level: 'max', overrides: {}, dismissedSuggestion: true },
              shell: { skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null, imageTrimMinutes: null } },
  light:    { page: { level: 'light', overrides: {}, dismissedSuggestion: true },
              shell: { skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192, imageTrimMinutes: 1 } },
  // Light in every way except the graphics card, so that one switch can be
  // priced on its own: disableHardwareAcceleration does not remove the GPU
  // process, it only puts it in software mode, so its worth is unknown.
  'light-gpu': { page: { level: 'light', overrides: { hardwareAcceleration: true }, dismissedSuggestion: true },
              shell: { skycordTitleBar: false, hardwareAcceleration: true, heapCapMb: 192, imageTrimMinutes: 1 } },
}
/** The idle phase is where growth shows, so it is long by default — but a
 *  diagnostic run needs to fail fast rather than after twenty minutes. */
const idleMs = Number(process.env.PROBE_IDLE_MS || 20 * 60_000)
const levelName = process.argv[process.argv.indexOf('--level') + 1]
const level = LEVELS[levelName] ?? LEVELS.max
if (levelName && !LEVELS[levelName]) {
  console.error(`--level must be one of: ${Object.keys(LEVELS).join(', ')}`); process.exit(1)
}

const appDir = fileURLToPath(new URL('..', import.meta.url))
// No trailing separator on profileDir: Playwright quotes every arg for
// CreateProcess, and a path ending in "\" right before the closing quote
// escapes that quote under Windows argv parsing, corrupting the rest of the
// command line — the app then exits before app.whenReady with no output at
// all. join() never leaves a trailing separator, so this is safe.
const probeDir = join(appDir, '.probe')
const profileDir = join(probeDir, 'profile-' + label)

// The profile must be COLD on every run, not just present. A run that
// reuses the same directory inherits whatever session cookie the previous
// run left behind — the app then opens already signed in, the sign-in form
// never appears, and a run that expects to log in hangs until its timeout.
// (This is exactly what happened the first time: a reused `profile/` dir
// carried a live session into the next run.) Comparability needs this too —
// a warm HTTP cache or warm profile would flatter whichever run reuses it,
// for reasons that have nothing to do with what's being measured. So wipe
// it before every run. Do not "optimise" this back into a reused directory.
// Windows keeps file handles for a moment after a process exits, and a
// chained run would otherwise fail to clear the one before it.
rmSync(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
// First launch shows the server picker unless a server is already saved.
// Writing the store directly into a scratch profile points the shell at the
// dev stack without ever touching the picker UI.
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'skycord.json'), JSON.stringify({ instanceOrigin: origin, perf: level.shell }))

const app = await _electron.launch({ args: ['.', `--user-data-dir=${profileDir}`], cwd: appDir })
// Electron's getAppMetrics() reports memory.workingSetSize/privateBytes in
// KILOBYTES already (see Electron's MemoryInfo docs) — dividing by 1024 here
// converts that to MB. A second /1024 anywhere downstream (the brief's
// original summary line had one) silently turns real hundreds-of-MB numbers
// into a bogus "0 MB"; caught by a dry run before the real 20-minute run.
const samples = []
const sample = async (phase) => {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
  const rows = metrics.map(m => ({ type: m.type, ws: Math.round((m.memory?.workingSetSize ?? 0) / 1024), priv: Math.round((m.memory?.privateBytes ?? 0) / 1024) }))
  samples.push({ t: Date.now(), phase, total_ws: rows.reduce((s, r) => s + r.ws, 0), total_priv: rows.reduce((s, r) => s + r.priv, 0), rows })
}
let died = false
app.on('close', () => { died = true })
const every10s = setInterval(() => sample('tick').catch(() => {}), 10_000)
/** The idle phase is the point of the run, so it waits in short steps and
 *  gives up the moment the app is gone — a dead app samples nothing, and
 *  twenty minutes of that looks exactly like a healthy idle in the log. */
const idle = async (ms) => {
  for (let left = ms; left > 0; left -= 5_000) {
    if (died) throw new Error('the app exited during the run — nothing after this point was measured')
    await wait(Math.min(5_000, left))
  }
}

try {
  const page = await (async () => {
    for (let i = 0; i < 200; i++) { const p = app.windows().find(w => w.url().startsWith(origin)); if (p) return p; await wait(100) }
    throw new Error('the app never opened the dev stack — is desk-web running?')
  })()

  await sample('loaded')
  // Don't assume the login form is there — with a cold profile it always is,
  // but the harness should say what it found rather than time out opaquely
  // 25 minutes in if that ever stops being true. Race the sign-in field
  // against the signed-in shell's own rail (`nav.rail .ri` only renders once
  // ChatApp is mounted, i.e. already authenticated); whichever appears first
  // decides the branch. The loser is left to time out into a swallowed
  // rejection rather than awaited, so it can't cause an unhandled rejection
  // later.
  const raceSelectors = (selectors, timeout) => new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(`Neither ${selectors.join(' nor ')} appeared within ${timeout}ms — is desk-web serving the client this probe expects?`)) }
    }, timeout)
    for (const sel of selectors) {
      page.waitForSelector(sel, { timeout }).then(() => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(sel) }
      }).catch(() => {})
    }
  })

  const found = await raceSelectors(['#login-identifier', 'nav.rail .ri'], 30_000)
  if (found === '#login-identifier') {
    // Login accepts a username or an email in one field — no
    // input[type=email] on this form (that type is reserved for register).
    await page.fill('#login-identifier', env.PROBE_EMAIL)
    await page.fill('#login-password', env.PROBE_PASSWORD)
    await page.keyboard.press('Enter')
    // A signed-in session lands on Home (the friends list), not on a
    // server — the server rail (`.ri`, excluding the Home icon `.ri.home`)
    // is what proves sign-in happened.
    await page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 })
  } // else: already signed in (only possible if the profile wipe above is ever removed) — nothing to do.

  // The page keeps its level in localStorage, which a cold profile does not
  // have, so it boots at Full whatever the shell was told. Seed it and reload:
  // eviction, tile caps and the rest are read live, but reloading is what makes
  // the measured session start the way a real one at this level would.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value),
    ['sykord_perf', JSON.stringify(level.page)])
  await page.reload()
  await page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 })
  console.log(`level: ${levelName ?? 'max'}`)

  await sample('signed-in')
  await page.click('nav.rail .ri:not(.home)')
  // Channel rows render as `.ch-item`, with the clickable control being the
  // `.ch-open` button inside it (text rows call selectChannel, the voice row
  // calls joinVoiceChannel) — `.ch` does not exist in this client.
  await page.waitForSelector('.ch-open', { timeout: 15_000 })

  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  for (const ch of await page.$$('.ch-open')) {
    await ch.click(); await wait(1500)
    // A text channel shows its scrollable history in `.ml`; the voice
    // channel instead opens the call stage, which has nothing to scroll —
    // give it the same settle time without wheeling over empty space.
    // `.mouse.move` rather than `elementHandle.hover()`: the message pane
    // can stay below Playwright's actionability bar (mid-transition, zero
    // layout box for a moment) well past a generous timeout, even though
    // wheel events over that point work fine once the mouse is just there.
    const ml = await page.$('.ml')
    if (ml) {
      await page.mouse.move(viewport.width * 0.65, viewport.height * 0.5)
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -4000); await wait(900) }
    } else {
      await wait(4500)
    }
    await sample('scrolled')
  }
  await sample('channels-open')
  await idle(idleMs)
  await sample('idle')
} finally {
  clearInterval(every10s)
}

mkdirSync(probeDir, { recursive: true })
// The process list changes during a run — a renderer appears when the page
// loads, utilities come and go — so a column per process would put a different
// process under the same heading from one row to the next. The totals are
// columns; the split rides in one quoted field, named, so it stays readable
// however many processes there were.
const split = (rows) => '"' + rows.map(r => `${r.type} ${r.ws}/${r.priv}`).join('; ') + '"'
const csv = ['phase,total_ws_mb,total_priv_mb,processes,split_type_ws/priv_mb']
  .concat(samples.map(s => [s.phase, s.total_ws, s.total_priv, s.rows.length, split(s.rows)].join(',')))
writeFileSync(join(probeDir, `${label}.csv`), csv.join('\n'))
const last = samples[samples.length - 1]
console.log(`${label}: ${Math.round(last.total_priv)} MB private, ${Math.round(last.total_ws)} MB working set after idle`)
await app.close()
