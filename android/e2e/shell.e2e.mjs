/**
 * The Android shell, end to end, on the emulator.
 *
 * Needs: the emulator running (`emulator -avd skycord35 -ports 6554,6555`), the debug APK
 * installed, `adb reverse tcp:6200 tcp:6200`, and the dev stack: the client
 * on 6200 and its API on 3050 (`node .dev/desk-api.mjs` in
 * H:\projects\sykord-wt). It makes its own throwaway account on that local
 * API; nothing here touches a real server.
 *
 * The dev API pins its cookie to `localhost`, so only http://localhost:6200
 * can hold a session. The second server (http://127.0.0.1:6200) is checked
 * for asking its own sign-in, and the first for staying signed in.
 *
 *   node android/e2e/shell.e2e.mjs
 */
import { createRequire } from 'module'
import { execSync } from 'child_process'

const { _android } = createRequire(new URL('../../desktop/package.json', import.meta.url))('playwright-core')

const PKG = 'xyz.skycord.android'
const API = 'http://127.0.0.1:3050'
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const passes = p => p.then(() => true, () => false)
const wait = ms => new Promise(r => setTimeout(r, ms))

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

// ── the device ───────────────────────────────────────────────────────────
const [device] = await _android.devices()
if (!device) { console.error('no emulator: start one with `emulator -avd skycord35 -ports 6554,6555`'); process.exit(1) }
const sh = async cmd => (await device.shell(cmd)).toString()
const back = () => sh('input keyevent 4')
// An open keyboard takes the first Back for itself, as on any phone: it never
// reaches the app. A user closes the keyboard, then goes back; so does this.
const keyboardUp = async () => (await sh('dumpsys input_method | grep mInputShown')).includes('mInputShown=true')
const hideKeyboard = async () => { if (await keyboardUp()) { await back(); await wait(500) } }
// What is on the phone's screen, read with the stock uiautomator (Playwright's
// own device.wait/tap need its driver APK, which is a download). Each node is
// { text, 'content-desc', bounds, … }.
const screenNodes = async () => {
  await sh('uiautomator dump /sdcard/e2e-ui.xml')
  const xml = await sh('cat /sdcard/e2e-ui.xml')
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => Object.fromEntries([...n.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])))
}
const onScreen = async text => (await screenNodes()).find(n => n.text === text || n['content-desc'] === text)
const screenHas = async (text, { gone = false, timeout = 15000 } = {}) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { if (!!(await onScreen(text)) !== gone) return true } catch { /* a dump can fail mid-transition: look again */ }
    await wait(500)
  }
  return false
}
const tapText = async text => {
  const node = await onScreen(text)
  if (!node) throw new Error(`nothing on screen says "${text}"`)
  const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number)
  await sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`)
}
const inFront = async () => (await sh('dumpsys window | grep mCurrentFocus')).includes(PKG)
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
check('localhost gets no http warning', await launcher.locator('#found-warning').isHidden())
await launcher.click('#found-open')

// ── sign in ──────────────────────────────────────────────────────────────
let app = await pageOf('localhost:6200')
check('the server\u2019s own sign-in page loads', await passes(app.waitForSelector('#login-identifier', { timeout: 30000 })))
check('the bridge is there', await app.evaluate(() => window.skycordAndroid?.platform === 'android'))
await app.fill('#login-identifier', account.username)
await app.fill('#login-password', account.password)
await app.getByRole('button', { name: 'Sign In', exact: true }).click()
check('signing in works', await passes(app.waitForSelector('#login-identifier', { state: 'detached', timeout: 40000 })))
await wait(2000)

// ── outside links ────────────────────────────────────────────────────────
const before = app.url()
await app.evaluate(() => { location.href = 'https://example.org/' })
await wait(1500)
check('an outside link leaves the WebView where it was', app.url() === before, app.url())
// The shell cancels that navigation, so Chromium never reports it finished, and
// Playwright would wait on it forever before the next click. The page is fine
// (the URL above proves it); tell Playwright not to wait.
process.env.PLAYWRIGHT_SKIP_NAVIGATION_CHECK = '1'
await launch()   // the phone's browser took the front; bring the app back

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
check('reopening shows the same server, still signed in', await app.evaluate(() => !document.querySelector('#login-identifier')))

// ── the file picker ──────────────────────────────────────────────────────
// A real tap (Playwright's click is a user gesture), as the icon and music
// pickers get; Chromium only opens a picker for one.
await app.evaluate(() => {
  const input = Object.assign(document.createElement('input'), { type: 'file', id: 'e2e-file', accept: 'audio/*,.flac' })
  Object.assign(input.style, { position: 'fixed', top: '0', left: '0', width: '200px', height: '60px', zIndex: '99999' })
  input.addEventListener('change', () => { window.__e2ePicked = input.files.length })
  document.body.appendChild(input)
})
await app.click('#e2e-file')
await wait(1500)
check('a file input opens the phone\u2019s picker', (await sh('dumpsys window | grep mCurrentFocus')).includes('documentsui'))
await back(); await wait(800)
check('cancelling the picker returns to the app with nothing chosen',
  (await inFront()) && await app.evaluate(() => { const n = window.__e2ePicked; document.querySelector('#e2e-file')?.remove(); return n === undefined || n === 0 }))

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
// Wait for the signed-in app itself (its server rail), so a page that has not
// drawn anything yet cannot pass for "no sign-in form".
await passes(app.waitForSelector('.ri.home', { timeout: 30000 }))
check('switching back keeps the first server signed in', await app.evaluate(() => !!document.querySelector('.ri.home') && !document.querySelector('#login-identifier')))

// ── a server that cannot be reached ──────────────────────────────────────
await sh(`am force-stop ${PKG}`)
execSync('adb reverse --remove tcp:6200')
await launch()
check('an unreachable server gets the native screen', await screenHas('Retry'))
execSync('adb reverse tcp:6200 tcp:6200')
await tapText('Retry')
check('Retry loads it once it is back', await screenHas('Retry', { gone: true }))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
await device.close()
process.exit(results.every(Boolean) ? 0 : 1)
