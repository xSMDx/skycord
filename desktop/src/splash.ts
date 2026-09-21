/**
 * The launch screen: a small window with the Skycord mark and what the app is
 * doing — checking for updates, downloading one, installing it, starting. It
 * stays until the app's own window has something to show, then hands over.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import type { UpdateStatus } from './updates'

const SPLASH = join(app.getAppPath(), 'static', 'splash.html')

export type SplashStatus = UpdateStatus | { state: 'starting' }

export interface Splash {
  status(s: SplashStatus): void
  onSkip(cb: () => void): void
  close(): void
}

export const showSplash = (preload: string): Splash => {
  let last: SplashStatus = { state: 'starting' }
  let skip = () => {}
  const win = new BrowserWindow({
    width: 300,
    height: 340,
    center: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Skycord',
    backgroundColor: '#111214',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-finish-load', () => win.webContents.send('splash:status', last))
  win.once('ready-to-show', () => win.show())
  void win.loadFile(SPLASH)

  ipcMain.on('splash:skip', event => { if (!win.isDestroyed() && event.sender === win.webContents) skip() })

  return {
    status(s) {
      last = s
      if (!win.isDestroyed()) win.webContents.send('splash:status', s)
    },
    onSkip(cb) { skip = cb },
    close() { if (!win.isDestroyed()) win.close() },
  }
}
