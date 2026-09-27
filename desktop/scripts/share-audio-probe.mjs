// Drives the packaged shell through a real window share with audio, to prove
// the whole path works: picker → utility process → MessagePort → AudioWorklet
// → a published LiveKit track.
//
// Everything below the port was proven by the addon's own smoke tests. This is
// about the four links above it, which unit tests only ever saw through fakes.
//
// Local dev stack only, like the memory probe it is modelled on.
import { createRequire } from 'module'
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { spawn } from 'child_process'
const { _electron } = createRequire('H:/projects/sykord-wt/desktop/desktop/package.json')('playwright-core')

const env = Object.fromEntries(readFileSync(new URL('./.probe.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const origin = env.PROBE_ORIGIN || ''
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  console.error('PROBE_ORIGIN must be the local dev stack, not a live server.'); process.exit(1)
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const appDir = fileURLToPath(new URL('..', import.meta.url))
const profileDir = join(appDir, '.probe', 'profile-shareaudio')
rmSync(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'skycord.json'), JSON.stringify({ instanceOrigin: origin }))

/**
 * Something for the capture to actually hear, in a window it can pick.
 *
 * It has to be a real top-level window, because desktopCapturer lists windows
 * and nothing else — a console started from here does not get one, since
 * Windows Terminal hosts it. So: a second Electron window playing a warbling
 * tone. Written out here rather than kept in the repo, because `.probe` is
 * scratch and this script should work from a clean checkout.
 */
const noiseDir = join(appDir, '.probe', 'noisemaker')
mkdirSync(noiseDir, { recursive: true })
writeFileSync(join(noiseDir, 'package.json'), JSON.stringify({ name: 'noisemaker', version: '1.0.0', main: 'main.js' }))
writeFileSync(join(noiseDir, 'main.js'), `
const { app, BrowserWindow } = require('electron')
const PAGE = 'data:text/html,' + encodeURIComponent(\`
<title>SKYCORD CAPTURE TARGET</title>
<body style="background:#111;color:#0f0;font:28px system-ui;display:grid;place-items:center;height:100vh;margin:0">
  <div>SKYCORD CAPTURE TARGET</div>
  <script>
    const ctx = new AudioContext()
    const osc = ctx.createOscillator(), g = ctx.createGain()
    osc.frequency.value = 440; g.gain.value = 0.25
    osc.connect(g).connect(ctx.destination); osc.start()
    // Warbling, so a recording is obviously this and not something else.
    setInterval(() => { osc.frequency.value = osc.frequency.value === 440 ? 660 : 440 }, 500)
  <\\/script>
</body>\`)
app.whenReady().then(() => {
  new BrowserWindow({ width: 560, height: 260, title: 'SKYCORD CAPTURE TARGET', autoHideMenuBar: true }).loadURL(PAGE)
})
`)
const noise = spawn(process.execPath,
  [join(appDir, 'node_modules', 'electron', 'cli.js'), noiseDir],
  { stdio: 'ignore', windowsHide: false })
await new Promise(r => setTimeout(r, 6000))
const step = (n, msg) => console.log(`[${n}] ${msg}`)

const app = await _electron.launch({ args: ['.', `--user-data-dir=${profileDir}`], cwd: appDir })
// Surface what the shell itself says: when the port never arrives, the reason
// is on its side of the boundary, not the page's.
const relay = (stream, mark) => stream?.on('data', d => String(d)
  .split(/\r?\n/).filter(l => /share|audio|pid|Error/i.test(l))
  .forEach(l => console.log(`  ${mark}`, l.trim())))
relay(app.process().stdout, 'main>')
relay(app.process().stderr, 'main!')
let failed = null
try {
  const page = await (async () => {
    for (let i = 0; i < 200; i++) { const p = app.windows().find(w => w.url().startsWith(origin)); if (p) return p; await wait(100) }
    throw new Error('the app never opened the dev stack — is desk-api running?')
  })()
  step(1, 'app opened the dev stack')

  // Watch the renderer for the port and the published track, from the page's
  // own side, so this reports what the app really did rather than what the
  // main process believes it did.
  await page.evaluate(() => {
    window.__share = { port: false, added: [], tracks: [] }
    window.addEventListener('message', e => { if (e.data === 'share-audio-port') window.__share.port = true })
    // Record every track the app publishes, by patching WebRTC rather than
    // adding a hook to the app. What gets sent is the only thing that counts.
    const note = (track) => {
      if (!track || track.kind !== 'audio') return
      window.__share.added.push({ id: track.id, at: Date.now(), label: track.label })
      window.__share.tracks.push(track)
    }
    const addTrack = RTCPeerConnection.prototype.addTrack
    RTCPeerConnection.prototype.addTrack = function (t, ...s) { note(t); return addTrack.call(this, t, ...s) }
    const addTransceiver = RTCPeerConnection.prototype.addTransceiver
    RTCPeerConnection.prototype.addTransceiver = function (t, ...s) { note(t); return addTransceiver.call(this, t, ...s) }
  })

  await page.waitForSelector('#login-identifier', { timeout: 30_000 })
  await page.fill('#login-identifier', env.PROBE_EMAIL)
  await page.fill('#login-password', env.PROBE_PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 })
  step(2, 'signed in')

  await page.click('nav.rail .ri:not(.home)')
  await page.waitForSelector('.ch-open', { timeout: 15_000 })
  // The voice row joins the call the same way a member's click would.
  const rows = await page.$$('.ch-item')
  let joined = false
  for (const row of rows) {
    const cls = await row.getAttribute('class') ?? ''
    if (/voice/i.test(cls)) { await (await row.$('.ch-open')).click(); joined = true; break }
  }
  if (!joined) { const all = await page.$$('.ch-open'); await all[all.length - 1].click() }
  await wait(6000)
  step(3, 'joined a voice channel')

  // Start the share. The picker is a separate window, so drive it as one.
  const shareBtn = await page.$('[data-test="share-screen"], button[title*="creen" i], button[aria-label*="creen" i]')
  if (!shareBtn) throw new Error('no screen-share button found on the call bar')
  await shareBtn.click()

  const picker = await (async () => {
    for (let i = 0; i < 150; i++) {
      const w = app.windows().find(x => x.url().includes('share.html'))
      if (w) return w
      await wait(100)
    }
    throw new Error('the share picker never opened')
  })()
  step(4, 'share picker opened')

  await picker.waitForSelector('.tile', { timeout: 15_000 })
  const names = await picker.$$eval('.tile', els => els.map(e => e.textContent?.trim().slice(0, 40)))
  console.log('    all sources:'); names.forEach(n => console.log('      -', n))

  // Windows tab is the default. Confirm the audio row is offered and on.
  const audioState = await picker.evaluate(() => {
    const gear = document.getElementById('gear'); gear?.click()
    const item = document.getElementById('audio-item')
    return { present: !!item, disabled: item?.getAttribute('aria-disabled'), checked: item?.getAttribute('aria-checked'), desc: document.getElementById('audio-desc')?.textContent }
  })
  console.log('    audio row:', JSON.stringify(audioState))
  if (!audioState.present) throw new Error('the picker offered no audio row for a window')
  if (audioState.disabled === 'true') throw new Error('audio was disabled for a window — perAppAudio came back false')
  step(5, 'picker offers per-app audio for a window, default ' + audioState.checked)

  // Choose the noisy window.
  const picked = await picker.evaluate(() => {
    const tiles = [...document.querySelectorAll('.tile')]
    const t = tiles.find(x => /SKYCORD CAPTURE TARGET/i.test(x.textContent ?? ''))
    if (!t) return null
    t.click()
    return t.textContent?.trim().slice(0, 40)
  })
  if (!picked) throw new Error('the noisy window was not among the sources')
  const shareStartedAt = Date.now()
  step(6, 'chose the noisy window: ' + picked)

  await wait(8000)

  const result = await page.evaluate(async () => {
    const r = { port: window.__share.port, tracks: [], levels: null }
    // What did we actually publish?
    const lk = window.__lkRoom || null
    return { ...r, hasRoomHandle: !!lk }
  })
  console.log('    renderer saw the port:', result.port)
  if (!result.port) throw new Error('the page never received the audio port')
  step(7, 'the renderer received the capture port')

  // The helper process must exist while sharing.
  const helper = await app.evaluate(async ({ app }) =>
    app.getAppMetrics().filter(m => m.serviceName === 'skycord-share-audio' || m.name === 'skycord-share-audio').length)
  console.log('    helper processes:', helper)
  step(8, helper > 0 ? 'the capture helper is running' : 'NO helper process found')

  // The last link: is the published track carrying the tone, or silence?
  const level = await page.evaluate(async (shareStartedAt) => {
    const fresh = window.__share.tracks.filter((t, i) => window.__share.added[i].at >= shareStartedAt && t.readyState === 'live')
    if (!fresh.length) return { tracks: window.__share.added.length, fresh: 0 }
    const ctx = new AudioContext()
    const results = []
    for (const track of fresh) {
      const src = ctx.createMediaStreamSource(new MediaStream([track]))
      const an = ctx.createAnalyser(); an.fftSize = 2048
      src.connect(an)
      const buf = new Float32Array(an.fftSize)
      let peak = 0
      for (let i = 0; i < 40; i++) {
        an.getFloatTimeDomainData(buf)
        for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a }
        await new Promise(r => setTimeout(r, 50))
      }
      results.push({ id: track.id.slice(0, 8), peak: Number(peak.toFixed(4)) })
      src.disconnect()
    }
    await ctx.close()
    return { tracks: window.__share.added.length, fresh: fresh.length, results }
  }, shareStartedAt)
  console.log('    published audio tracks:', JSON.stringify(level))
  const loudest = Math.max(0, ...(level.results ?? []).map(r => r.peak))
  step(9, loudest > 0.01
    ? `the published track carries the tone (peak ${loudest})`
    : `the published track is SILENT (peak ${loudest})`)

  console.log(loudest > 0.01
    ? '\nRESULT: end to end, with real audio on the wire.'
    : '\nRESULT: the plumbing runs, but no audio reached the published track.')
} catch (e) {
  failed = e
  console.error('\nFAILED:', e.message)
} finally {
  noise.kill()
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
