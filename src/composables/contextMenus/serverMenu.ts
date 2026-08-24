/**
 * The menu behind the sidebar header's chevron.
 *
 * Ordered to match the reference the user supplied: read state first, then
 * the things that add to the server, then settings, then leaving, with the id
 * last. What the reference has and this app does not — Unmute Server,
 * Notification Settings, Hide Muted Channels, Privacy Settings, Edit
 * Per-server Profile — is simply absent rather than shown dead, because none
 * of it has any implementation to reach: there is no server-level mute, no
 * notification model, and no per-server profile.
 *
 * Server Settings is the one exception, shown disabled. It is next on the
 * roadmap and the user asked for that treatment explicitly elsewhere in this
 * menu family: a row that says "not yet" reads as a plan, while a missing row
 * reads as a thing the app cannot do.
 *
 * Rows that need ownership are gated rather than disabled, because the server
 * 403s a non-owner on invites, channel creation and deletion — a row that can
 * only ever fail is worse than no row.
 */
import { Check, UserPlus, Plus, FolderPlus, Copy, Trash2, LogOut, Settings } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuServer { id: string; name: string; owner?: string }

export interface ServerMenuHandlers {
  markRead:       (serverId: string) => void
  invitePeople:   (serverId: string) => void
  createChannel:  (serverId: string) => void
  createCategory: (serverId: string) => void
  leaveServer:    (serverId: string) => void
  deleteServer:   (serverId: string) => void
  copy:           (text: string, what: string) => void
}

/**
 * The three rows that add something to a server.
 *
 * Shared by the header chevron menu and the empty-sidebar menu rather than
 * written twice. Two menus offering the same actions under different labels
 * or in a different order is the drift that put two context menus in this
 * app in the first place.
 *
 * Owner-gated rather than disabled: the server 403s a non-owner on invites
 * and channel creation, and a row that can only ever fail is worse than no
 * row.
 */
export const buildAddRows = (serverId: string, h: ServerMenuHandlers): MenuItem[] => [
  { label: 'Invite to Server', icon: UserPlus, onSelect: () => h.invitePeople(serverId) },
  { label: 'Create Channel', icon: Plus, onSelect: () => h.createChannel(serverId) },
  // Sits beside Create Channel rather than only on a category header,
  // because a server with no categories yet has no header to right-click —
  // this is the only way to make the first one.
  { label: 'Create Category', icon: FolderPlus, onSelect: () => h.createCategory(serverId) },
]

/**
 * Right-click on empty sidebar space.
 *
 * Discord puts the add-actions here and it is where people reach for them —
 * the header chevron is a longer trip for the thing you do most in a young
 * server. Nothing but the add-rows: this is not a second server menu, and
 * duplicating Mark As Read / Leave / Delete here would make two menus that
 * have to be kept in step forever.
 *
 * Empty for a non-owner, and the caller opens nothing rather than an empty
 * box. Hide Muted Channels, which the reference shows at the top, is absent
 * for the same reason it is absent from the header menu: there is no
 * server-level mute to hide anything by.
 */
export const buildSidebarMenu = (
  server: MenuServer,
  myId: string | undefined,
  h: ServerMenuHandlers,
): MenuItem[] =>
  (!!myId && server.owner === myId) ? buildAddRows(server.id, h) : []

export const buildServerMenu = (
  server: MenuServer,
  myId: string | undefined,
  h: ServerMenuHandlers,
  /** Whether anything in this server is actually unread — Mark As Read is
   *  pointless otherwise, and a live row that does nothing is a small lie. */
  hasUnread = false,
): MenuItem[] => {
  // TODO(3c): invites and channel creation should become a per-role
  // permission rather than being owner-only, once a permissions model
  // exists. Until then this mirrors the server's owner-only enforcement.
  const isOwner = !!myId && server.owner === myId
  const items: MenuItem[] = [
    { label: 'Mark As Read', icon: Check, disabled: !hasUnread, onSelect: () => h.markRead(server.id) },
    { sep: true },
  ]
  if (isOwner) {
    items.push(...buildAddRows(server.id, h), { sep: true })
  }
  items.push(
    // Disabled, not missing — see the note at the top of this file.
    { label: 'Server Settings', icon: Settings, disabled: true, onSelect: () => {} },
    { sep: true },
    isOwner
      ? { label: 'Delete Server', icon: Trash2, danger: true, onSelect: () => h.deleteServer(server.id) }
      : { label: 'Leave Server',  icon: LogOut, danger: true, onSelect: () => h.leaveServer(server.id) },
    { sep: true },
    { label: 'Copy Server ID', icon: Copy, onSelect: () => h.copy(server.id, 'Server ID') },
  )
  return items
}
