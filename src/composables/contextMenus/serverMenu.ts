/**
 * The menu behind the sidebar header's chevron.
 *
 * Rows are gated on ownership rather than shown-and-disabled, because the
 * server 403s a non-owner on channel creation, invite management, and
 * deletion — a row that can only ever fail is worse than no row, which is
 * the same rule conversationMenu follows for its unimplemented entries.
 *
 * Server Settings is deliberately absent, not disabled: it has no
 * implementation at all yet (plan 3c+).
 */
import { UserPlus, Plus, FolderPlus, Copy, Trash2, LogOut } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuServer { id: string; name: string; owner?: string }

export interface ServerMenuHandlers {
  invitePeople:   (serverId: string) => void
  createChannel:  (serverId: string) => void
  createCategory: (serverId: string) => void
  leaveServer:    (serverId: string) => void
  deleteServer:   (serverId: string) => void
  copy:           (text: string, what: string) => void
}

export const buildServerMenu = (
  server: MenuServer,
  myId: string | undefined,
  h: ServerMenuHandlers,
): MenuItem[] => {
  // TODO(3c): invites and channel creation should become a per-role
  // permission rather than being owner-only, once a permissions model
  // exists. Until then this mirrors the server's owner-only enforcement.
  const isOwner = !!myId && server.owner === myId
  const items: MenuItem[] = []
  if (isOwner) {
    items.push(
      { label: 'Invite People', icon: UserPlus, onSelect: () => h.invitePeople(server.id) },
      { label: 'Create Channel', icon: Plus, onSelect: () => h.createChannel(server.id) },
      // Sits beside Create Channel rather than only on a category header,
      // because a server with no categories yet has no header to right-click —
      // this is the only way to make the first one.
      { label: 'Create Category', icon: FolderPlus, onSelect: () => h.createCategory(server.id) },
    )
  }
  items.push(
    { label: 'Copy Server ID', icon: Copy, onSelect: () => h.copy(server.id, 'Server ID') },
    { sep: true },
    isOwner
      ? { label: 'Delete Server', icon: Trash2, danger: true, onSelect: () => h.deleteServer(server.id) }
      : { label: 'Leave Server',  icon: LogOut, danger: true, onSelect: () => h.leaveServer(server.id) },
  )
  return items
}
