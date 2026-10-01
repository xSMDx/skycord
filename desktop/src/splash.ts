/**
 * The launch screen: a small window with the Skycord mark, shown until the
 * app's own window has something to show.
 *
 * It used to report the update check — "Checking for updates…", a progress
 * bar, and a "Continue without updating" button — because launch waited for
 * one. Launch no longer waits: the check runs in the background and Settings ›
 * Updates is where it is reported. With nothing left to say, the window says
 * one thing and says it in static HTML.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

const SPLASH = join(app.getAppPath(), 'static', 'splash.html')

export interface Splash {
  close(): void
}

export const showSplash = (preload: string): Splash => {
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
  win.once('ready-to-show', () => win.show())
  void win.loadFile(SPLASH)

  return {
    close() { if (!win.isDestroyed()) win.close() },
  }
}
