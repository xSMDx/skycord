/**
 * The screen-share picker: a small window over the app listing screens and
 * windows with live previews, stream quality, and audio for a whole screen.
 * It resolves with what was chosen, or null when closed.
 *
 * The page is local (static/share.html) and the preload gives it only
 * `skycordShare`. Every call is checked here against the open picker too.
 */
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { centredOver } from './windowBounds'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { FRAME_RATES, PRESETS, RESOLUTIONS, parseChoice, type Remembered, type ShareChoice } from './shareQuality'
import { toTiles } from './shareSources'

const SHARE = join(app.getAppPath(), 'static', 'share.html')
const SHARE_URL = pathToFileURL(SHARE).href
const THUMB = { width: 400, height: 225 }
const SIZE = { width: 880, height: 640 }

export interface PickOptions {
  /** Offer stream quality: only when the page asked first and captures with it. */
  quality: boolean
  /** Offer audio: the page asked for it, or will if it is chosen. */
  audio: boolean
  dark: boolean
  last: Remembered
}

interface Open {
  win: BrowserWindow
  opts: PickOptions
  /** Every source the page has been shown, id → name: the only ids it may choose. */
  shown: Map<string, string>
  finish: (choice: ShareChoice | null) => void
}
let open: Open | null = null

const fromPicker = (event: IpcMainInvokeEvent): Open | null =>
  open && event.sender === open.win.webContents && event.senderFrame?.url.split(/[?#]/)[0] === SHARE_URL ? open : null

ipcMain.handle('share:init', event => {
  const o = fromPicker(event)
  return o ? { quality: o.opts.quality, audio: o.opts.audio, last: o.opts.last, presets: PRESETS, resolutions: RESOLUTIONS, frameRates: FRAME_RATES } : null
})

ipcMain.handle('share:sources', async event => {
  const o = fromPicker(event)
  if (!o) return []
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMB, fetchWindowIcons: true })
  const own = new Set(BrowserWindow.getAllWindows().map(w => w.getMediaSourceId()))
  const primary = screen.getPrimaryDisplay().id
  const displays = screen.getAllDisplays().map(d => ({
    id: String(d.id),
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary,
  }))
  const byId = new Map(sources.map(s => [s.id, s]))
  return toTiles(sources.map(s => ({ id: s.id, name: s.name, displayId: s.display_id })), own, displays).map(t => {
    const s = byId.get(t.id)!
    o.shown.set(t.id, s.name)
    return {
      ...t,
      // JPEG keeps a refresh of twenty previews small. A minimised window has none.
      thumb: s.thumbnail.isEmpty() ? null : `data:image/jpeg;base64,${s.thumbnail.toJPEG(78).toString('base64')}`,
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }
  })
})

ipcMain.handle('share:choose', (event, value: unknown) => {
  const o = fromPicker(event)
  const choice = o ? parseChoice(value, o.shown) : null
  // A hidden control's value is not a choice: audio only if offered, and the
  // preview setting only where the web client asked first and can apply it.
  if (o && choice) o.finish({ ...choice, audio: o.opts.audio && choice.audio, hidePreview: o.opts.quality && choice.hidePreview })
})

ipcMain.handle('share:cancel', event => { fromPicker(event)?.finish(null) })

export const pickShareSource = (parent: BrowserWindow, opts: PickOptions): Promise<ShareChoice | null> => {
  // One picker at a time. A second request while it is open is refused.
  if (open) { open.win.focus(); return Promise.resolve(null) }

  const win = new BrowserWindow({
    ...centredOver(parent, SIZE),
    parent,
    modal: true,
    show: false,
    frame: false,
    minWidth: 640,
    minHeight: 460,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Share your screen',
    backgroundColor: opts.dark ? '#1a1b1e' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
  })

  return new Promise(resolve => {
    const o: Open = {
      win, opts, shown: new Map(),
      finish: choice => {
        if (open !== o) return
        open = null
        resolve(choice)
        if (!win.isDestroyed()) win.close()
      },
    }
    open = o
    win.on('closed', () => o.finish(null))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.once('ready-to-show', () => win.show())
    void win.loadFile(SHARE, { query: { theme: opts.dark ? 'dark' : 'light' } })
  })
}
