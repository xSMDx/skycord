/**
 * The menu behind a channel row in the sidebar (right-click or hover ⋯).
 *
 * Rows are gated on ownership rather than shown-and-disabled, same reasoning
 * as serverMenu: createChannel/updateChannel/deleteChannel all 403 a
 * non-owner server-side, so a non-owner's menu offers nothing that can only
 * ever fail — just the harmless Copy Channel ID.
 */
import { Pencil, Copy, Trash2 } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuChannel {
  id:       string
  name:     string
  type:     'text' | 'voice'
  serverId: string
}

export interface ChannelMenuHandlers {
  rename: (channel: MenuChannel) => void
  remove: (channel: MenuChannel) => void
  copy:   (text: string, what: string) => void
}

export const buildChannelMenu = (
  channel: MenuChannel,
  isOwner: boolean,
  h: ChannelMenuHandlers,
): MenuItem[] => {
  if (!isOwner) {
    return [
      { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(channel.id, 'Channel ID') },
    ]
  }
  return [
    { label: 'Edit Channel', icon: Pencil, onSelect: () => h.rename(channel) },
    { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(channel.id, 'Channel ID') },
    { sep: true },
    { label: 'Delete Channel', icon: Trash2, danger: true, onSelect: () => h.remove(channel) },
  ]
}
