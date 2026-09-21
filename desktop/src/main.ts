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
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { lookupInstance, normaliseAddress } from './instanceAddress'
import { readStore, writeStore } from './store'

const PICKER = join(app.getAppPath(), 'static', 'picker.html')
const PICKER_URL = pathToFileURL(PICKER).href

let win: BrowserWindow | null = null

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
  return w
}

const showPicker = () => { void win?.loadFile(PICKER) }
const openInstance = (origin: string) => { void win?.loadURL(`${origin}/`) }

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
  openInstance(clean)
})

app.whenReady().then(() => {
  win = createWindow()
  const origin = readStore().instanceOrigin
  const clean = origin ? normaliseAddress(origin) : null
  if (clean) openInstance(clean)
  else showPicker()
})

app.on('window-all-closed', () => app.quit())
