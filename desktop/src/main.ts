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

const PICKER = join(app.getAppPath(), 'static', 'picker.html')
const PICKER_URL = pathToFileURL(PICKER).href

// A plain-http server on the network needs its origin treated as secure, or
// the microphone is refused. Chromium reads that switch only at startup, so it
// is set here, before the app is ready, from what was saved last time.
const startupOrigin = normaliseAddress(readStore().instanceOrigin ?? '')
if (startupOrigin && needsSecureOriginSwitch(startupOrigin)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', startupOrigin)
}

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
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, current)) void w.loadURL(url)
    else leave(url)
    return { action: 'deny' }
  })
  return w
}

const showPicker = () => { current = null; void win?.loadFile(PICKER) }
const openInstance = (origin: string) => { current = origin; void win?.loadURL(`${origin}/`) }

// The picker's calls are honoured only from the picker page itself. The preload
// already withholds the API from any other page; this is the second lock.
const fromPicker = (event: IpcMainInvokeEvent): boolean => event.senderFrame?.url === PICKER_URL

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
  writeStore({ ...readStore(), instanceOrigin: undefined })
  showPicker()
})

// No page may embed another browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.whenReady().then(() => {
  // Permissions go to the chosen origin only, and only the ones a chat app needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permissionAllowed(permission, details.requestingUrl, current)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, current))
  handleDisplayMedia(() => win, () => current)

  win = createWindow()
  const origin = readStore().instanceOrigin
  const clean = origin ? normaliseAddress(origin) : null
  if (clean) openInstance(clean)
  else showPicker()
})

app.on('window-all-closed', () => app.quit())
