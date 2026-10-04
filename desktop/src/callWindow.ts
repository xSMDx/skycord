/**
 * The incoming-call window: small, always on top, bottom-right of the work
 * area. It shows who is calling and answers through the page, which owns the
 * call — this window only asks. The ringtone stays in the page, so there is
 * one source of sound.
 */
import { BrowserWindow, screen, app, type WebContents } from 'electron'
import { join } from 'path'
import type { RingInfo } from './notice'

const CALL = join(app.getAppPath(), 'static', 'call.html')
const W = 320, H = 132, MARGIN = 16

export type CallColors = { bar: string; text: string; muted: string } | null

let win: BrowserWindow | null = null
let last: (RingInfo & { colors: CallColors }) | null = null

export const showCall = (preload: string, info: RingInfo, colors: CallColors): void => {
  last = { ...info, colors }
  if (win && !win.isDestroyed()) { win.webContents.send('call:info', last); win.showInactive(); return }
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    width: W, height: H,
    x: area.x + area.width - W - MARGIN, y: area.y + area.height - H - MARGIN,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, title: 'Incoming call',
    backgroundColor: colors?.bar ?? '#1e1f22',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.once('did-finish-load', () => { if (last) win?.webContents.send('call:info', last); win?.showInactive() })
  win.on('closed', () => { win = null })
  void win.loadFile(CALL)
}

export const hideCall = (): void => {
  if (win && !win.isDestroyed()) win.close()
  win = null
  last = null
}

export const isCallWindow = (contents: WebContents): boolean =>
  !!win && !win.isDestroyed() && contents === win.webContents
