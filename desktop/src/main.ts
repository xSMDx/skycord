/**
 * Skycord for Windows — a thin shell.
 *
 * The window loads an instance's own web client rather than a copy bundled
 * here, so the UI is always the version that server runs. The page gets no
 * Node, no Electron and no filesystem: contextIsolation, no nodeIntegration,
 * and the renderer sandboxed. A preload bridge is the only surface it gains.
 */
import { app, BrowserWindow } from 'electron'

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
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
    },
  })
  // Shown once painted, so the first frame is the app and not a white flash.
  win.once('ready-to-show', () => win.show())
  return win
}

app.whenReady().then(() => {
  createWindow().loadURL('about:blank')
})

app.on('window-all-closed', () => app.quit())
