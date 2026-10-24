/**
 * The Android shell, end to end, on the emulator.
 *
 * Run it from a shell where the toolchain is on PATH:
 *
 *   source android/env.sh
 *   node android/e2e/shell.e2e.mjs
 *
 * Needs (it checks the first three and refuses to run without them):
 *  - `adb` on PATH (that is what `source android/env.sh` does);
 *  - exactly one running emulator, e.g.
 *      emulator -avd skycord35 -ports 6554,6555 -no-snapshot -no-audio
 *    A real phone is refused: the script wipes the app's data;
 *  - the debug APK installed (`cd android && ./gradlew assembleDebug`, then
 *    `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`);
 *  - the dev client on port 6200, started in this worktree with
 *      npx vite --host 0.0.0.0 --port 6200 --strictPort
 *    (its proxy goes to the API on the port in `.env` `API_PORT`, 3200 here);
 *  - the dev API on port 3200: `node .dev/desk-api.mjs` from H:\projects\sykord-wt.
 *
 * What it does to the machine: it runs `adb reverse tcp:6200 tcp:6200` (and
 * leaves it in place), `pm clear`s the app (all its saved servers and
 * sign-ins are gone), removes that reverse for a moment to make a server
 * unreachable and puts it back, and registers a throwaway account and server
 * on the local dev API, which stay in the local dev database. Nothing here
 * touches a real server.
 *
 * The dev API pins its cookie to `localhost`, so only http://localhost:6200
 * can hold a session. The second server (http://127.0.0.1:6200) is checked
 * for asking its own sign-in, and the first for staying signed in.
 *
 * Not covered here: the old-WebView screen on Android 8. That is a separate,
 * manual check on the API 26 image (plan, Task 12, Step 3).
 */
import { createRequire } from 'module'
import { execSync } from 'child_process'

// The number of checks below. A run that makes fewer or more has lost or grown
// a check by accident, and fails.
const EXPECTED = 23

try { execSync('adb version', { stdio: 'pipe' }) } catch {
  console.error('adb is not on PATH: run `source android/env.sh` first')
  process.exit(1)
}

const { _android } = createRequire(new URL('../../desktop/package.json', import.meta.url))('playwright-core')

const PKG = 'xyz.skycord.android'
const API = 'http://127.0.0.1:3050'
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const passes = p => p.then(() => true, () => false)
const wait = ms => new Promise(r => setTimeout(r, ms))
// Look until `fn` is true (a throw counts as "not yet"), up to `ms`.
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms
  do {
    try { if (await fn()) return true } catch { /* look again */ }
    await wait(250)
  } while (Date.now() < end)
  return false
}

// ── the device ───────────────────────────────────────────────────────────
// Only an emulator: the script clears the app's data.
const devices = await _android.devices()
const emulators = devices.filter(d => d.serial().startsWith('emulator-'))
if (emulators.length !== 1) {
  console.error(emulators.length === 0
    ? `no emulator${devices.length ? ` (a real device is refused: ${devices.map(d => d.serial()).join(', ')})` : ''}: start one with \`emulator -avd skycord35 -ports 6554,6555\``
    : `more than one emulator is running (${emulators.map(d => d.serial()).join(', ')}): leave just one`)
  process.exit(1)
}
const device = emulators[0]
const serial = device.serial()
const adb = args => execSync(`adb -s ${serial} ${args}`, { stdio: 'pipe' })
adb('reverse tcp:6200 tcp:6200')

const sh = async cmd => (await device.shell(cmd)).toString()
const back = () => sh('input keyevent 4')
const focus = async () => (await sh('dumpsys window | grep mCurrentFocus')).trim()
const inFront = async () => (await focus()).includes(PKG)
// An open keyboard takes the first Back for itself, as on any phone: it never
// reaches the app. A user closes the keyboard, then goes back; so does this.
const keyboardUp = async () => (await sh('dumpsys input_method | grep mInputShown')).includes('mInputShown=true')
const hideKeyboard = async () => { if (await keyboardUp()) { await back(); await wait(500) } }
// What is on the phone's screen, read with the stock uiautomator (Playwright's
// own device.wait/tap need its driver APK, which is a download). Each node is
// { text, 'content-desc', bounds, … }. The old dump is removed first, and a
// dump that did not happen throws, so a stale or missing file is never read as
// the current screen (or as an empty one, where everything is "gone").
const screenNodes = async () => {
  await sh('rm -f /sdcard/e2e-ui.xml; uiautomator dump /sdcard/e2e-ui.xml')
  const xml = await sh('cat /sdcard/e2e-ui.xml')
  if (!xml.includes('<hierarchy')) throw new Error('no screen dump')
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => Object.fromEntries([...n.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])))
}
const onScreen = async text => (await screenNodes()).find(n => n.text === text || n['content-desc'] === text)
const screenHas = (text, { gone = false, timeout = 15000 } = {}) => until(async () => !!(await onScreen(text)) !== gone, timeout)
const tapText = async text => {
  let node
  await until(async () => (node = await onScreen(text)), 5000)
  if (!node) throw new Error(`nothing on screen says "${text}"`)
  const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number)
  await sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`)
}
const launch = async () => { await sh(`am start -n ${PKG}/.MainActivity`); await wait(2500) }
const pageOf = async (urlPart) => {
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
// The signed-in app: its server rail is there (it exists only once the client
// has loaded and is signed in) and the sign-in form is not.
const signedIn = page => page.evaluate(() => !!document.querySelector('.ri.home') && !document.querySelector('#login-identifier'))

// ── a throwaway account, with a server to open, on the local dev API ─────
// The password satisfies server/utils/validators.ts (no hyphen: it is not
// in the accepted set of special characters).
const tag = Date.now().toString(36)
const account = { username: `droid_${tag}`, email: `droid_${tag}@example.com`, password: `Droid!${tag}A1`, displayName: 'Droid' }
const post = async (path, body, token) => {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
const { accessToken } = await post('/auth/register', account)
const serverName = `Android E2E ${tag}`
await post('/servers', { name: serverName }, accessToken)

await sh(`pm clear ${PKG}`)
await launch()

// ── first launch ─────────────────────────────────────────────────────────
let launcher = await pageOf('appassets.androidplatform.net')
await launcher.waitForSelector('#servers li')
check('first launch shows the launcher', await launcher.locator('text=Join a server by address').isVisible())
check('it offers the hosted server', await launcher.locator('text=the hosted server').isVisible())

await launcher.fill('#address', 'not an address at all')
await launcher.click('#check')
await launcher.waitForSelector('#problem:not([hidden])')
check('a wrong address gets a plain reason', /doesn.t look like a server address/.test(await launcher.locator('#problem').textContent()))

await launcher.fill('#address', 'http://localhost:5999')
await launcher.click('#check')
check('an unreachable address says so', await passes(launcher.waitForFunction(
  () => /Couldn.t reach/.test(document.querySelector('#problem')?.textContent ?? ''), null, { timeout: 10000 })))

await launcher.fill('#address', 'http://localhost:6200')
await launcher.click('#check')
const carded = await passes(launcher.waitForSelector('#found:not([hidden])', { timeout: 10000 }))
check('a real server shows its card', carded && (await launcher.locator('#found-host').textContent()) === 'localhost:6200')
// The warning must exist (a renamed id would read as "hidden" too) and be hidden.
check('localhost gets no http warning', (await launcher.locator('#found-warning').count()) === 1 && await launcher.locator('#found-warning').isHidden())
await launcher.click('#found-open')

// ── sign in ──────────────────────────────────────────────────────────────
let app = await pageOf('localhost:6200')
check('the server\u2019s own sign-in page loads', await passes(app.waitForSelector('#login-identifier', { timeout: 30000 })))
check('the bridge is there', await app.evaluate(() => window.skycordAndroid?.platform === 'android'))
await app.fill('#login-identifier', account.username)
await app.fill('#login-password', account.password)
await app.getByRole('button', { name: 'Sign In', exact: true }).click()
check('signing in works',
  await passes(app.waitForSelector('#login-identifier', { state: 'detached', timeout: 40000 })) &&
  await passes(app.waitForSelector('.ri.home', { timeout: 40000 })))
await wait(2000)

// ── outside links ────────────────────────────────────────────────────────
const before = app.url()
await app.evaluate(() => { location.href = 'https://example.org/' })
// The shell hands the link to the phone: another app (its browser) takes the front.
const browserOpened = await until(async () => { const m = (await focus()).match(/u0 ([\w.]+)\//); return !!m && m[1] !== PKG })
const stayed = app.url() === before
// The shell cancels that navigation, so Chromium never reports it finished, and
// Playwright would wait on it forever before the next click. The page is fine
// (the URL proves it); tell Playwright not to wait, until the page is replaced
// further down.
process.env.PLAYWRIGHT_SKIP_NAVIGATION_CHECK = '1'
await launch()   // the phone's browser took the front; bring the app back
const stillThere = await app.evaluate(() => location.href).then(h => h === before, () => false)
check('an outside link opens the phone\u2019s browser and leaves the WebView where it was',
  browserOpened && stayed && stillThere, `browser took the front: ${browserOpened}; page: ${app.url()}`)

// ── the back button: overlay → conversation → list → background ─────────
const onConversation = () => app.evaluate(() => !!document.querySelector('.shell.m-chat'))
await app.click(`[role="button"][aria-label="${serverName}"]`)
await wait(1000)
// Entering a server may already open its landing channel on a phone.
if (!(await onConversation())) await app.click('.ch-item:not(.voice)')
await wait(800)
check('a channel opens as a conversation', await onConversation())
await app.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
await wait(500)
check('the quick switcher opens', await app.evaluate(() => !!document.querySelector('[role="dialog"]')))
await hideKeyboard()   // its search box opens the keyboard
await back(); await wait(600)
check('back closes what is open on top', await app.evaluate(() => !document.querySelector('[role="dialog"]')))
check('\u2026and stays in the conversation', await onConversation())
await back(); await wait(600)
check('back from a conversation goes to the list', !(await onConversation()))
await back(); await wait(800)
check('back at the list puts the app in the background', !(await inFront()))
await launch()
check('reopening shows the same server, still signed in', await signedIn(app))

// ── the file picker ──────────────────────────────────────────────────────
// A real tap (Playwright's click is a user gesture), as the icon and music
// pickers get; Chromium only opens a picker for one.
await app.evaluate(() => {
  const input = Object.assign(document.createElement('input'), { type: 'file', id: 'e2e-file', accept: 'audio/*,.flac' })
  Object.assign(input.style, { position: 'fixed', top: '0', left: '0', width: '200px', height: '60px', zIndex: '99999' })
  input.addEventListener('change', () => { window.__e2ePicked = input.files.length })
  document.body.appendChild(input)
})
const pickerUp = () => until(async () => (await focus()).includes('documentsui'))
const nothingPicked = () => app.evaluate(() => { const n = window.__e2ePicked; return n === undefined || n === 0 })
await app.click('#e2e-file')
check('a file input opens the phone\u2019s picker', await pickerUp())
await back()
const cameBack = await until(inFront)
const emptyAfterCancel = await nothingPicked()
// A cancel the app never answered would leave the input unable to open the
// picker again: open it a second time, then back out of it again.
await app.click('#e2e-file')
const reopened = await pickerUp()
await back()
const cameBackAgain = await until(inFront)
const emptyAfterSecond = await nothingPicked()
await app.evaluate(() => document.querySelector('#e2e-file')?.remove())
check('cancelling the picker returns to the app with nothing chosen, and the input opens it again',
  cameBack && emptyAfterCancel && reopened && cameBackAgain && emptyAfterSecond,
  `back to the app: ${cameBack}; nothing chosen: ${emptyAfterCancel}; opens again: ${reopened}; back again: ${cameBackAgain}; still nothing: ${emptyAfterSecond}`)

// ── a second server, and the first stays signed in ──────────────────────
// Fire and forget: the page is replaced before the reply could arrive.
await app.evaluate(() => { void window.skycordAndroid.changeInstance() })
launcher = await pageOf('appassets.androidplatform.net')
await launcher.waitForSelector('#address')
await launcher.fill('#address', 'http://127.0.0.1:6200')
await launcher.click('#check')
await launcher.waitForSelector('#found:not([hidden])', { timeout: 10000 })
await launcher.click('#found-open')
const second = await pageOf('127.0.0.1:6200')
check('a new server asks for its own sign-in', await passes(second.waitForSelector('#login-identifier', { timeout: 30000 })))
await second.evaluate(() => { void window.skycordAndroid.changeInstance() })
launcher = await pageOf('appassets.androidplatform.net')
await launcher.locator('.lc-open', { hasText: 'localhost:6200' }).click()
app = await pageOf('localhost:6200')
delete process.env.PLAYWRIGHT_SKIP_NAVIGATION_CHECK   // the page that held the cancelled navigation is gone
// Wait for the signed-in app itself (its server rail), so a page that has not
// drawn anything yet cannot pass for "no sign-in form".
await passes(app.waitForSelector('.ri.home', { timeout: 30000 }))
check('switching back keeps the first server signed in', await signedIn(app))

// ── a server that cannot be reached ──────────────────────────────────────
let unreachableShown = false
try {
  await sh(`am force-stop ${PKG}`)
  adb('reverse --remove tcp:6200')
  await launch()
  unreachableShown = await screenHas('Retry')
} finally {
  adb('reverse tcp:6200 tcp:6200')   // the server is back, whatever happened above
}
check('an unreachable server gets the native screen', unreachableShown)
let retryLoaded = false
if (unreachableShown) {
  await tapText('Retry')
  const retryGone = await screenHas('Retry', { gone: true })
  // The button going away is not the server loading: wait for the signed-in app.
  if (retryGone) {
    try {
      app = await pageOf('localhost:6200')
      retryLoaded = await passes(app.waitForSelector('.ri.home', { timeout: 30000 })) && await signedIn(app)
    } catch { /* no page: not loaded */ }
  }
}
check('Retry loads it once it is back', retryLoaded)

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} passed`)
if (results.length !== EXPECTED) console.log(`FAIL  expected ${EXPECTED} checks, ran ${results.length}`)
await device.close()
process.exit(results.every(Boolean) && results.length === EXPECTED ? 0 : 1)
