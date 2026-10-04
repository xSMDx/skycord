/**
 * Mute and Notification Settings, the two rows a server, a category and a
 * channel menu share. Discord's shape: Mute ▸ how long (or Unmute while
 * muted), and Notification Settings ▸ which messages notify, with the current
 * one checked.
 *
 * A server's own default is Only @mentions, so a server offers three levels
 * and "Only @mentions" stores 'default'. A category or channel adds Use Server
 * Default, which inherits from above (notifyLevels.placeLevel).
 *
 * The level rows close the menu rather than staying open: an open flyout
 * holds its rows as they were when it opened, so its check would not move.
 */
import { Bell, BellOff, BellRing } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'
import { convPref, MUTE_OPTIONS } from '../useConvPrefs'
import type { LevelChoice } from '../notifyLevels'

export type NotifyScope = 'server' | 'category' | 'channel'

export interface NotifyHandlers {
  /** null unmutes, 'forever' mutes indefinitely, an ISO string mutes until then. */
  setMute:  (id: string, mute: string | null) => void
  setLevel: (id: string, level: LevelChoice) => void
}

const NOUN: Record<NotifyScope, string> = { server: 'Server', category: 'Category', channel: 'Channel' }

const LEVELS: Record<'server' | 'inherits', { label: string; value: LevelChoice }[]> = {
  server: [
    { label: 'All Messages',   value: 'all' },
    { label: 'Only @mentions', value: 'default' },
    { label: 'Nothing',        value: 'nothing' },
  ],
  inherits: [
    { label: 'Use Server Default', value: 'default' },
    { label: 'All Messages',       value: 'all' },
    { label: 'Only @mentions',     value: 'mentions' },
    { label: 'Nothing',            value: 'nothing' },
  ],
}

export const notifyRows = (id: string, scope: NotifyScope, h: NotifyHandlers): MenuItem[] => {
  const p = convPref(id)
  const stored = p.level ?? 'default'
  // A server holding an explicit 'mentions' is at its default all the same.
  const current = scope === 'server' && stored === 'mentions' ? 'default' : stored
  const noun = NOUN[scope]
  return [
    p.muted
      ? { label: `Unmute ${noun}`, icon: Bell, onSelect: () => h.setMute(id, null) }
      : {
          label: `Mute ${noun}`, icon: BellOff,
          submenu: MUTE_OPTIONS.map(o => ({ label: o.label, onSelect: () => h.setMute(id, o.value()) })),
        },
    {
      label: 'Notification Settings', icon: BellRing,
      submenu: LEVELS[scope === 'server' ? 'server' : 'inherits'].map(l => ({
        label: l.label,
        check: l.value === current,
        // The checked row is where you already are: no write for no change.
        onSelect: l.value === current ? undefined : () => h.setLevel(id, l.value),
      })),
    },
  ]
}
