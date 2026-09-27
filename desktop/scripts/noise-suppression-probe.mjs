// Does the noise suppression actually suppress noise, and does it leave
// speech alone?
//
// The app is launched with Chromium's fake microphone fed from a known wav,
// so the same input can be run through each mode and the published track
// measured. It patches RTCPeerConnection from outside rather than adding a
// hook to the app: what reaches the wire is the only thing that counts.
//
//   node scripts/noise-suppression-probe.mjs [--modes off,rnnoise,deepfilter]
//
// Local dev stack only.
import { createRequire } from 'module'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { join } from 'path'
const { _electron } = createRequire('H:/projects/sykord-wt/desktop/desktop/package.json')('playwright-core')

const env = Object.fromEntries(readFileSync(new URL('./.probe.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const origin = env.PROBE_ORIGIN || ''
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  console.error('PROBE_ORIGIN must be the local dev stack, not a live server.'); process.exit(1)
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const MODES = arg('--modes', 'off,rnnoise,deepfilter').split(',')
const wait = ms => new Promise(r => setTimeout(r, ms))
const appDir = fileURLToPath(new URL('..', import.meta.url))
const audio = join(appDir, '.probe', 'audio')
for (const f of ['noise-only.wav', 'speech-plus-noise.wav']) {
  if (!existsSync(join(audio, f))) { console.error(`missing ${f} — run scripts/make-test-audio.mjs first`); process.exit(1) }
}

/**
 * Run one mode against one input and report what the published track carried.
 *
 * Measured in two windows: the first second, which is noise alone in both
 * files, and the rest, which is where the speech is. A suppressor that works
 * drops the first a long way; a suppressor that is merely a mute drops both.
 */
/**
 * ONE profile for every run, deliberately kept warm.
 *
 * The memory probe wipes its profile because a warm cache would flatter what
 * it measures. Here the opposite is true: a cold profile means a fresh login
 * for every mode, and the API rate-limits logins to a handful per fifteen
 * minutes — a four-mode comparison locks the account out halfway through.
 * Nothing this probe measures cares whether the profile is warm, so the
 * session is signed in once and reused.
 */
const profileDir = join(appDir, '.probe', 'profile-noise')
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'skycord.json'), JSON.stringify({ instanceOrigin: origin }))

const run = async (mode, wav) => {

  const app = await _electron.launch({
    cwd: appDir,
    args: [
      '.', `--user-data-dir=${profileDir}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(audio, wav)}`,
    ],
  })
  try {
    const page = await (async () => {
      for (let i = 0; i < 200; i++) { const p = app.windows().find(w => w.url().startsWith(origin)); if (p) return p; await wait(100) }
      throw new Error('the app never opened the dev stack — is desk-api running?')
    })()

    page.on('console', m => { if (/error|warn|deepfilter|rnnoise|worklet|wasm|mic/i.test(m.text())) console.log('   page:', m.text().slice(0, 200)) })
    page.on('pageerror', e => console.log('   pageerror:', String(e).slice(0, 200)))
    // Already signed in on the second run and after: race the login field
    // against the signed-in rail rather than assuming either.
    const seen = await Promise.race([
      page.waitForSelector('#login-identifier', { timeout: 30_000 }).then(() => 'login').catch(() => null),
      page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 }).then(() => 'in').catch(() => null),
    ])
    if (seen === 'login') {
      await page.fill('#login-identifier', env.PROBE_EMAIL)
      await page.fill('#login-password', env.PROBE_PASSWORD)
      await page.keyboard.press('Enter')
      await page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 })
    } else if (seen !== 'in') {
      throw new Error('neither the login form nor the signed-in rail appeared')
    }

    // The mode, and an open gate: the voice-activity gate would otherwise
    // close over the quiet parts and be credited to the suppressor.
    await page.evaluate(m => {
      const cur = JSON.parse(localStorage.getItem('sykord_voice') || '{}')
      localStorage.setItem('sykord_voice', JSON.stringify({ ...cur, noiseMode: m, sensitivity: 0, echoCancellation: false }))
    }, mode)
    await page.reload()
    await page.waitForSelector('nav.rail .ri:not(.home)', { timeout: 30_000 })

    // Catch the microphone track as it is published — and, crucially, as it
    // is REPLACED. LiveKit applies a processor by building a new track and
    // swapping it in with replaceTrack, so the track handed to addTrack is
    // the raw capture and measuring it would report no filtering at all.
    await page.evaluate(() => {
      window.__ns = { added: [], replaced: [] }
      const note = (list, t) => { if (t && t.kind === 'audio') list.push(t) }
      const a = RTCPeerConnection.prototype.addTrack
      RTCPeerConnection.prototype.addTrack = function (t, ...s) { note(window.__ns.added, t); return a.call(this, t, ...s) }
      const b = RTCPeerConnection.prototype.addTransceiver
      RTCPeerConnection.prototype.addTransceiver = function (t, ...s) { note(window.__ns.added, t); return b.call(this, t, ...s) }
      const c = RTCRtpSender.prototype.replaceTrack
      RTCRtpSender.prototype.replaceTrack = function (t) { note(window.__ns.replaced, t); return c.call(this, t) }
    })

    await page.click('nav.rail .ri:not(.home)')
    await page.waitForSelector('.ch-open', { timeout: 15_000 })
    const rows = await page.$$('.ch-item')
    let joined = false
    for (const row of rows) {
      if (/voice/i.test(await row.getAttribute('class') ?? '')) { await (await row.$('.ch-open')).click(); joined = true; break }
    }
    if (!joined) { const all = await page.$$('.ch-open'); await all[all.length - 1].click() }

    // DeepFilterNet fetches and compiles multi-megabyte wasm the first time.
    await wait(mode === 'deepfilter' ? 14_000 : 8000)

    return await page.evaluate(async () => {
      // The last replacement is what is actually being sent; fall back to
      // the originally added track only if nothing was ever swapped in.
      const live = l => l.filter(t => t.readyState === 'live')
      const track = live(window.__ns.replaced).pop() ?? live(window.__ns.added).pop()
      if (!track) return { error: 'no live audio track was published' }
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(new MediaStream([track]))
      const an = ctx.createAnalyser(); an.fftSize = 2048
      src.connect(an)
      const buf = new Float32Array(an.fftSize)
      const rms = []
      for (let i = 0; i < 120; i++) {           // ~6 s at 50 ms
        an.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        rms.push(Math.sqrt(sum / buf.length))
        await new Promise(r => setTimeout(r, 50))
      }
      await ctx.close()
      const sorted = [...rms].sort((a, b) => a - b)
      return {
        // The quietest tenth is the gaps between words; the loudest tenth is
        // speech. Suppression should widen the distance between them.
        quiet: Number(sorted[Math.floor(sorted.length * 0.1)].toFixed(5)),
        median: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(5)),
        loud: Number(sorted[Math.floor(sorted.length * 0.9)].toFixed(5)),
        source: window.__ns.replaced.length ? 'replaced' : 'added',
      }
    })
  } finally {
    await app.close().catch(() => {})
  }
}

const dB = (a, b) => (a > 0 && b > 0 ? (20 * Math.log10(b / a)).toFixed(1) : 'n/a')
const results = {}
for (const wav of ['noise-only.wav', 'speech-plus-noise.wav']) {
  console.log(`\n=== ${wav} ===`)
  results[wav] = {}
  for (const mode of MODES) {
    const r = await run(mode, wav)
    results[wav][mode] = r
    console.log(`  ${mode.padEnd(11)} ${r.error ? 'ERROR: ' + r.error : `quiet ${r.quiet}  median ${r.median}  loud ${r.loud}`}`)
  }
  const base = results[wav][MODES[0]]
  if (base && !base.error) {
    for (const mode of MODES.slice(1)) {
      const r = results[wav][mode]
      if (!r.error) console.log(`  ${mode} vs ${MODES[0]}: median ${dB(base.median, r.median)} dB, quiet ${dB(base.quiet, r.quiet)} dB`)
    }
  }
}
console.log('\n(negative dB means quieter than the unfiltered run — that is suppression)')
