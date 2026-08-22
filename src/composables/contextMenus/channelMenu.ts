/**
 * The menu behind a channel row in the sidebar (right-click or hover ⋯).
 *
 * Rows are gated on ownership rather than shown-and-disabled, same reasoning
 * as serverMenu: createChannel/updateChannel/deleteChannel all 403 a
 * non-owner server-side, so a non-owner's menu offers nothing that can only
 * ever fail — just the harmless Copy Channel ID.
 */
import { Pencil, FolderInput, Copy, Trash2 } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuChannel {
  id:       string
  name:     string
  type:     'text' | 'voice'
  serverId: string
  /** Which category the channel currently sits in; null = uncategorised. */
  category?: string | null
}

/** Just enough of a category to list it as a move target. */
export interface MoveTargetCategory {
  id:   string
  name: string
}

export interface ChannelMenuHandlers {
  rename: (channel: MenuChannel) => void
  remove: (channel: MenuChannel) => void
  /** `categoryId: null` files the channel as uncategorised. */
  move:   (channel: MenuChannel, categoryId: string | null) => void
  copy:   (text: string, what: string) => void
}

/** Label for the "no category" target, shared with the test so the two cannot drift. */
export const UNCATEGORISED_LABEL = 'Uncategorised'

/**
 * The move targets: "Uncategorised" first (mirroring groupedChannels, where
 * the headerless group leads), then every category in the order the caller
 * passed them — which is `activeCategories`, already position-sorted, so the
 * submenu reads in the same order as the sidebar.
 *
 * The channel's CURRENT home is marked with a check and given no `onSelect`.
 * Selecting it is therefore a no-op rather than a PATCH that would move the
 * channel to where it already is, emit a `channel:updated` to every member,
 * and — for the uncategorised row on a channel that is already uncategorised
 * — do all that for literally no change. Left interactive rather than
 * `disabled` on purpose: a disabled row renders greyed and drops out of
 * keyboard navigation, which is the wrong treatment for the one row whose job
 * is to tell you where you are.
 */
const buildMoveSubmenu = (
  channel: MenuChannel,
  categories: MoveTargetCategory[],
  h: ChannelMenuHandlers,
): MenuItem[] => {
  const current = channel.category ?? null
  const row = (id: string | null, label: string): MenuItem =>
    id === current
      ? { label, check: true }
      : { label, onSelect: () => h.move(channel, id) }
  return [
    row(null, UNCATEGORISED_LABEL),
    ...categories.map(c => row(c.id, c.name)),
  ]
}

export const buildChannelMenu = (
  channel: MenuChannel,
  isOwner: boolean,
  h: ChannelMenuHandlers,
  categories: MoveTargetCategory[] = [],
): MenuItem[] => {
  if (!isOwner) {
    return [
      { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(channel.id, 'Channel ID') },
    ]
  }
  return [
    { label: 'Edit Channel', icon: Pencil, onSelect: () => h.rename(channel) },
    // Omitted entirely when the server has no categories: the submenu would
    // hold one row, "Uncategorised", which is where the channel already is —
    // a row that can only ever be a no-op, behind a parent that promises a
    // choice there is none of. The row reappears the moment a category
    // exists, and buildCategoryMenu / buildServerMenu are where one gets made.
    ...(categories.length
      ? [{ label: 'Move to Category', icon: FolderInput, submenu: buildMoveSubmenu(channel, categories, h) } as MenuItem]
      : []),
    { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(channel.id, 'Channel ID') },
    { sep: true },
    { label: 'Delete Channel', icon: Trash2, danger: true, onSelect: () => h.remove(channel) },
  ]
}
