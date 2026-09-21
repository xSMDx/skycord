/**
 * The Servers window: the servers saved in the app, to switch between, rename,
 * re-address, remove or add to. Opened from Settings › Servers, the Jump List,
 * or an older client's Switch server button.
 *
 * It is the local picker page in its own window, so the saved list never
 * passes through a server's web page: no server can read which others the
 * member uses.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { centredOver } from './windowBounds'

const PICKER = join(app.getAppPath(), 'static', 'picker.html')
let open: BrowserWindow | null = null

export const openServersWindow = (parent: BrowserWindow, dark: boolean, preload: string): void => {
  if (open && !open.isDestroyed()) { open.focus(); return }
  const w = new BrowserWindow({
    ...centredOver(parent, { width: 560, height: 640 }),
    parent,
    modal: true,
    show: false,
    frame: false,
    minWidth: 460,
    minHeight: 420,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Servers',
    backgroundColor: dark ? '#111214' : '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  open = w
  w.on('closed', () => { if (open === w) open = null })
  w.webContents.on('will-navigate', e => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.once('ready-to-show', () => w.show())
  void w.loadFile(PICKER, { query: { mode: 'manage', theme: dark ? 'dark' : 'light' } })
}

export const closeServersWindow = (): void => {
  if (open && !open.isDestroyed()) open.close()
}
