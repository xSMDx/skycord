/**
 * Skycord for Windows — a thin shell.
 *
 * The window loads an instance's own web client rather than a copy bundled
 * here, so the UI is always the version that server runs. The page gets no
 * Node, no Electron and no filesystem: contextIsolation, no nodeIntegration,
 * and the renderer sandboxed. The preload is the only surface it gains.
 *
 * First launch shows a local picker; after that the saved instance opens
 * directly.
 */
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { lookupInstance, normaliseAddress } from './instanceAddress'
import { readStore, writeStore } from './store'
import { externalSafe, needsSecureOriginSwitch, permissionAllowed, sameOrigin } from './rules'
import { handleDisplayMedia } from './displayMedia'
import { startUpdates } from './updates'

const PICKER = join(app.getAppPath(), 'static', 'picker.html')
const PICKER_URL = pathToFileURL(PICKER).href

// A plain-http server on the network needs its origin treated as secure, or
// the microphone is refused. Chromium reads that switch only at startup, so it
// is set here, before the app is ready, from what was saved last time.
const startupOrigin = normaliseAddress(readStore().instanceOrigin ?? '')
if (startupOrigin && needsSecureOriginSwitch(startupOrigin)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', startupOrigin)
}

// One Skycord at a time. A second launch (a shortcut, or the Jump List's
// Switch server) hands its arguments to the one running and exits.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
const SWITCH = '--switch-server'

let win: BrowserWindow | null = null
/** The instance on screen; null while the picker is showing. */
let current: string | null = null

const createWindow = (): BrowserWindow => {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'Skycord',
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
  })
  // Shown once painted, so the first frame is the app and not a white flash.
  w.once('ready-to-show', () => w.show())

  // The page may move within its own origin. Anything else is a link out:
  // web links open in the system browser, everything else is dropped.
  const leave = (url: string) => { if (externalSafe(url)) void shell.openExternal(url) }
  w.webContents.on('will-navigate', (event, url) => {
    if (sameOrigin(url, current)) return
    event.preventDefault()
    leave(url)
  })
  w.webContents.on('will-redirect', (event, url) => {
    if (current && !sameOrigin(url, current)) { event.preventDefault(); leave(url) }
  })
  // A server that doesn't answer must not leave a blank window. Back to the
  // picker, which says so. The saved server stays, so the next launch retries.
  w.webContents.on('did-fail-load', (_e, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted, not failed */ || !current || !sameOrigin(url, current)) return
    const origin = current
    current = null
    void w.loadFile(PICKER, { query: { unreachable: origin } })
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, current)) void w.loadURL(url)
    else leave(url)
    return { action: 'deny' }
  })
  return w
}

const showPicker = () => { current = null; void win?.loadFile(PICKER) }
const openInstance = (origin: string) => { current = origin; void win?.loadURL(`${origin}/`) }
/** Forget the saved server and show the picker. */
const switchServer = () => { writeStore({ ...readStore(), instanceOrigin: undefined }); showPicker() }

// The picker's calls are honoured only from the picker page itself. The preload
// already withholds the API from any other page; this is the second lock.
const fromPicker = (event: IpcMainInvokeEvent): boolean => event.senderFrame?.url.split(/[?#]/)[0] === PICKER_URL

ipcMain.handle('picker:lookup', (event, address: unknown) => {
  if (!fromPicker(event) || typeof address !== 'string') return { ok: false, reason: 'Not allowed.' }
  return lookupInstance(address)
})

ipcMain.handle('picker:choose', (event, origin: unknown) => {
  if (!fromPicker(event) || typeof origin !== 'string') return
  // Never trust the page's string: reduce it to an origin again.
  const clean = normaliseAddress(origin)
  if (!clean) return
  writeStore({ ...readStore(), instanceOrigin: clean })
  // A newly chosen plain-http server takes effect only after a restart. The
  // short wait lets the picker say so before the window goes.
  if (needsSecureOriginSwitch(clean) && clean !== startupOrigin) {
    setTimeout(() => { app.relaunch(); app.exit(0) }, 1200)
    return { restarting: true }
  }
  openInstance(clean)
  return { restarting: false }
})

// Switch server: forget this instance and show the picker. Honoured only from
// the instance on screen.
ipcMain.handle('desktop:changeInstance', (event) => {
  if (!sameOrigin(event.senderFrame?.url ?? '', current)) return
  switchServer()
})

app.on('second-instance', (_e, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  if (argv.includes(SWITCH)) switchServer()
})

// No page may embed another browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.whenReady().then(() => {
  if (!primary) return
  // Permissions go to the chosen origin only, and only the ones a chat app needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permissionAllowed(permission, details.requestingUrl, current)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, current))
  handleDisplayMedia(() => win, () => current)

  win = createWindow()
  const origin = readStore().instanceOrigin
  const clean = origin ? normaliseAddress(origin) : null
  if (process.argv.includes(SWITCH)) switchServer()
  else if (clean) openInstance(clean)
  else showPicker()

  // Right-click the taskbar icon for Switch server. It works whatever the
  // server's web client is: one too old to have the button, or one that's down.
  if (process.platform === 'win32') {
    app.setUserTasks([{
      program: process.execPath,
      arguments: app.isPackaged ? SWITCH : `"${app.getAppPath()}" ${SWITCH}`,
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Switch server',
      description: 'Choose a different Skycord server',
    }])
  }
  startUpdates(() => win)
})

app.on('window-all-closed', () => app.quit())
