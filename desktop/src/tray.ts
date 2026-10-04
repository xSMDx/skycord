/**
 * The tray icon, its menu, and the taskbar badge and flash. The menu's
 * contents and the images chosen come from trayModel.ts; this only renders
 * them and routes the clicks.
 */
import { Tray, Menu, nativeImage, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { trayMenu, trayAsset, badgeAsset, type TrayState, type TrayItem } from './trayModel'

const img = (name: string) => nativeImage.createFromPath(join(app.getAppPath(), 'static', 'tray', `${name}.png`))

export interface TrayHooks {
  window(): BrowserWindow | null
  showWindow(): void
  command(c: 'mute' | 'deafen'): void
  checkUpdates(): void
  quit(): void
}

let tray: Tray | null = null
let hooks: TrayHooks | null = null
let state: TrayState = { inCall: false, muted: false, deafened: false, unread: 0 }

const render = () => {
  if (!tray || !hooks) return
  const h = hooks
  const item = (i: TrayItem): MenuItemConstructorOptions => {
    if (i.id === 'sep') return { type: 'separator' }
    const id = i.id
    const click = () => {
      if (id === 'open') h.showWindow()
      else if (id === 'mute' || id === 'deafen') h.command(id)
      else if (id === 'updates') h.checkUpdates()
      else if (id === 'quit') h.quit()
    }
    return i.checked === undefined
      ? { label: i.label, click }
      : { label: i.label, type: 'checkbox', checked: i.checked, click }
  }
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state).map(item)))
  tray.setImage(img(trayAsset(state.unread)))
  tray.setToolTip(state.unread ? `Skycord — ${state.unread} unread` : 'Skycord')
  const win = h.window()
  if (win && process.platform === 'win32') {
    const badge = badgeAsset(state.unread)
    win.setOverlayIcon(badge ? img(`badge-${badge}`) : null, badge ? `${state.unread} unread` : '')
  }
}

export const initTray = (h: TrayHooks): void => {
  hooks = h
  tray = new Tray(img('tray'))
  tray.on('click', () => h.showWindow())
  render()
}

export const updateTray = (next: Partial<TrayState>): void => { state = { ...state, ...next }; render() }

/** Flash the taskbar button until the window is focused (Windows stops it on focus). */
export const flashTaskbar = (): void => {
  const win = hooks?.window()
  if (win && !win.isFocused()) win.flashFrame(true)
}

export const destroyTray = (): void => { tray?.destroy(); tray = null }
