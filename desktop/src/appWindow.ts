/**
 * The app's window: Skycord's own title bar across the top, and the page (an
 * instance's web client, or the local server picker) in a view below it.
 *
 * The title bar is a local page the app draws, not part of the web client, so
 * it is there for every server, including ones whose client predates it. The
 * client only feeds it: the page title, back/forward, and its theme's colours.
 * Windows' own minimise, maximise and close sit over its right end
 * (titleBarOverlay), recoloured to match; maximise keeps Snap Layouts.
 */
import { app, BrowserWindow, WebContentsView, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import { DEFAULT_COLORS, type TitleColors, type TitleState } from './titleState'

export const TITLEBAR_HEIGHT = 32
const TITLEBAR = join(app.getAppPath(), 'static', 'titlebar.html')

export interface AppWindow {
  win: BrowserWindow
  /** The page: an instance's web client, or the local picker. */
  page: WebContents
  setTitle(state: TitleState): void
  setColors(colors: TitleColors): void
}

export const createAppWindow = (preload: string, onNavigate: (dir: 'back' | 'forward') => void): AppWindow => {
  let state: TitleState = { title: 'Skycord', kind: 'app', icon: null, canBack: false, canForward: false }
  let colors = DEFAULT_COLORS
  const secure = { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'Skycord',
    backgroundColor: colors.bar,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.text, height: TITLEBAR_HEIGHT },
    webPreferences: secure,
  })
  const view = new WebContentsView({ webPreferences: secure })
  view.setBackgroundColor('#111214')
  win.contentView.addChildView(view)
  const page = view.webContents

  // The page fills everything below the bar; in full screen, everything.
  const layout = () => {
    const [width, height] = win.getContentSize()
    const top = win.isFullScreen() ? 0 : TITLEBAR_HEIGHT
    view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
  }
  // (One cast: TypeScript can't pick an overload for a union of event names.)
  for (const e of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(e as 'resize', layout)
  // A video the page puts in full screen takes the whole window with it.
  page.on('enter-html-full-screen', () => win.setFullScreen(true))
  page.on('leave-html-full-screen', () => win.setFullScreen(false))
  layout()

  // The bar is a fixed local page: it never navigates and opens nothing.
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const push = () => {
    win.webContents.send('titlebar:state', state)
    win.webContents.send('titlebar:colors', colors)
  }
  win.webContents.on('did-finish-load', push)
  void win.webContents.loadFile(TITLEBAR)

  // Keys belong to the page: give it focus whenever the window has it.
  win.on('focus', () => page.focus())
  win.once('ready-to-show', () => { win.show(); page.focus() })

  const navigate = (dir: 'back' | 'forward') => { onNavigate(dir); page.focus() }
  ipcMain.on('titlebar:nav', (event, dir: unknown) => {
    if (event.sender === win.webContents && (dir === 'back' || dir === 'forward')) navigate(dir)
  })
  // The mouse's own back and forward buttons.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') navigate('back')
    if (cmd === 'browser-forward') navigate('forward')
  })

  return {
    win,
    page,
    setTitle(next) {
      state = next
      win.setTitle(next.title && next.title !== 'Skycord' ? `${next.title} - Skycord` : 'Skycord')
      push()
    },
    setColors(next) {
      colors = next
      win.setBackgroundColor(next.bar)
      win.setTitleBarOverlay({ color: next.bar, symbolColor: next.text, height: TITLEBAR_HEIGHT })
      push()
    },
  }
}
