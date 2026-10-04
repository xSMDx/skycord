/** The tray and taskbar, as data: what the menu holds and which image shows. Pure. */
export interface TrayState { inCall: boolean; muted: boolean; deafened: boolean; unread: number }
export type TrayItem =
  | { id: 'open' | 'mute' | 'deafen' | 'updates' | 'quit'; label: string; checked?: boolean }
  | { id: 'sep' }

export const trayMenu = (s: TrayState): TrayItem[] => {
  const call: TrayItem[] = s.inCall
    ? [{ id: 'mute', label: 'Mute', checked: s.muted }, { id: 'deafen', label: 'Deafen', checked: s.deafened }, { id: 'sep' }]
    : []
  return [
    { id: 'open', label: 'Open Skycord' },
    { id: 'sep' },
    ...call,
    { id: 'updates', label: 'Check for updates' },
    { id: 'sep' },
    { id: 'quit', label: 'Quit Skycord' },
  ]
}

/** The taskbar badge image's name under static/tray/badge-<name>.png, or null for none. */
export const badgeAsset = (unread: number): string | null =>
  unread <= 0 ? null : unread > 9 ? '9plus' : String(Math.floor(unread))

export const trayAsset = (unread: number): 'tray' | 'tray-unread' => (unread > 0 ? 'tray-unread' : 'tray')

/** What the window's close button does. */
export const closeAction = (s: { quitting: boolean; keepInTray: boolean }): 'hide' | 'close' =>
  !s.quitting && s.keepInTray ? 'hide' : 'close'
