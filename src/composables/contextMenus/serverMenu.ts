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
 * Rows that need a permission are gated rather than disabled, because the
 * server refuses anyone without it — a row that can only ever fail is worse
 * than no row. Each follows the permission its endpoint checks, not
 * ownership: inviting is Create Invite (which @everyone holds by default),
 * channels and categories are Manage Channels, voice servers Manage Server.
 * These were owner-only here long after the server stopped requiring it.
 * Deleting the server is the one thing still the owner's alone.
 */
import { Check, UserPlus, Plus, FolderPlus, Copy, Trash2, LogOut, Settings, Server as ServerIcon } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuServer { id: string; name: string; owner?: string }

/**
 * What the viewer may do here, resolved from their permissions — the owner
 * holds every one. Presentation only: each endpoint checks again.
 */
export interface ServerMenuAccess {
  /** Create Invite. */
  invite:         boolean
  /** Manage Channels: create channels and categories. */
  manageChannels: boolean
  /** Manage Server: the voice servers this server registers. */
  manageServer:   boolean
}

export interface ServerMenuHandlers {
  markRead:       (serverId: string) => void
  invitePeople:   (serverId: string) => void
  createChannel:  (serverId: string) => void
  createCategory: (serverId: string) => void
  leaveServer:    (serverId: string) => void
  deleteServer:   (serverId: string) => void
  voiceServers:   (serverId: string) => void
  serverSettings: (serverId: string) => void
  copy:           (text: string, what: string) => void
}

/**
 * The rows that add something to a server, as many as the viewer may use.
 *
 * Shared by the header chevron menu and the empty-sidebar menu rather than
 * written twice. Two menus offering the same actions under different labels
 * or in a different order is the drift that put two context menus in this
 * app in the first place.
 */
export const buildAddRows = (serverId: string, h: ServerMenuHandlers, can: ServerMenuAccess): MenuItem[] => [
  ...(can.invite
    ? [{ label: 'Invite to Server', icon: UserPlus, onSelect: () => h.invitePeople(serverId) } as MenuItem]
    : []),
  ...(can.manageChannels
    ? [
        { label: 'Create Channel', icon: Plus, onSelect: () => h.createChannel(serverId) } as MenuItem,
        // Sits beside Create Channel rather than only on a category header,
        // because a server with no categories yet has no header to
        // right-click — this is the only way to make the first one.
        { label: 'Create Category', icon: FolderPlus, onSelect: () => h.createCategory(serverId) } as MenuItem,
      ]
    : []),
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
 * Empty for someone who may add nothing, and the caller then opens nothing
 * rather than an empty box. Hide Muted Channels, which the reference shows at
 * the top, is absent for the same reason it is absent from the header menu:
 * there is no server-level mute to hide anything by.
 */
export const buildSidebarMenu = (
  server: MenuServer,
  h: ServerMenuHandlers,
  can: ServerMenuAccess,
): MenuItem[] => buildAddRows(server.id, h, can)

export const buildServerMenu = (
  server: MenuServer,
  myId: string | undefined,
  h: ServerMenuHandlers,
  can: ServerMenuAccess,
  /** Whether anything in this server is actually unread — Mark As Read is
   *  pointless otherwise, and a live row that does nothing is a small lie. */
  hasUnread = false,
): MenuItem[] => {
  const isOwner = !!myId && server.owner === myId
  const items: MenuItem[] = [
    { label: 'Mark As Read', icon: Check, disabled: !hasUnread, onSelect: () => h.markRead(server.id) },
    { sep: true },
  ]
  // Only when there is something to add: a separator under nothing would
  // leave two touching.
  const add = buildAddRows(server.id, h, can)
  if (add.length) items.push(...add, { sep: true })
  // Server Settings is open to every member — they can read the name,
  // description and who else is in here, with the fields disabled for them.
  // Voice Servers keeps its own row because it was a working screen of its
  // own before settings existed.
  items.push(
    { label: 'Server Settings', icon: Settings, onSelect: () => h.serverSettings(server.id) },
    ...(can.manageServer
      ? [{ label: 'Voice Servers', icon: ServerIcon, onSelect: () => h.voiceServers(server.id) } as MenuItem]
      : []),
    { sep: true },
    isOwner
      ? { label: 'Delete Server', icon: Trash2, danger: true, onSelect: () => h.deleteServer(server.id) }
      : { label: 'Leave Server',  icon: LogOut, danger: true, onSelect: () => h.leaveServer(server.id) },
    { sep: true },
    { label: 'Copy Server ID', icon: Copy, onSelect: () => h.copy(server.id, 'Server ID') },
  )
  return items
}
