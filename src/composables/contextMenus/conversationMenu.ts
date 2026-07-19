/**
 * Sidebar conversation menus — one for 1:1 DMs, one for group DMs.
 *
 * Right-click and the row's ⋯ button both open these, so the two can't drift
 * (previously ⋯ opened a bespoke menu and right-click did nothing at all).
 *
 * Pin and Mute are specified but absent until their backend lands — see
 * docs/superpowers/specs/2026-07-19-context-menus-design.md. A row that does
 * nothing is worse than no row.
 */
import {
  PhUser, PhPhoneCall, PhEnvelopeOpen, PhX, PhTrash,
  PhCopy, PhSignOut, PhPencilSimple, PhLink,
} from '@phosphor-icons/vue'
import type { MenuItem } from '../useContextMenu'
import type { MenuUser } from './userMenu'

export interface DMMenuHandlers {
  markRead:    (convId: string) => void
  openProfile: (u: MenuUser) => void
  startCall:   (u: MenuUser) => void | Promise<void>
  closeDM:     (convId: string) => void
  deleteDM:    (convId: string) => void
  copy:        (text: string, what: string) => void
}

export interface GroupMenuHandlers {
  markRead:    (convId: string) => void
  openInvites: (convId: string) => void
  editGroup:   (convId: string) => void
  hideGroup:   (convId: string) => void
  leaveGroup:  (convId: string) => void
  copy:        (text: string, what: string) => void
}

export const dmMenu = (
  conv: { id: string; user: MenuUser; unread?: number },
  h: DMMenuHandlers,
): MenuItem[] => [
  { label: 'Mark As Read', icon: PhEnvelopeOpen, disabled: !conv.unread,
    onSelect: () => h.markRead(conv.id) },
  { sep: true },
  { label: 'Profile',      icon: PhUser,      onSelect: () => h.openProfile(conv.user) },
  { label: 'Start a Call', icon: PhPhoneCall, onSelect: () => void h.startCall(conv.user) },
  { sep: true },
  { label: 'Copy User ID',    icon: PhCopy, onSelect: () => h.copy(conv.user.id, 'User ID') },
  { label: 'Copy Channel ID', icon: PhCopy, onSelect: () => h.copy(conv.id, 'Channel ID') },
  { sep: true },
  { label: 'Close DM', icon: PhX, onSelect: () => h.closeDM(conv.id) },
  { label: 'Delete Conversation', icon: PhTrash, danger: true,
    onSelect: () => h.deleteDM(conv.id) },
]

export const groupMenu = (
  conv: { id: string; unread?: number },
  h: GroupMenuHandlers,
): MenuItem[] => [
  { label: 'Mark As Read', icon: PhEnvelopeOpen, disabled: !conv.unread,
    onSelect: () => h.markRead(conv.id) },
  { sep: true },
  { label: 'Invites',    icon: PhLink,         onSelect: () => h.openInvites(conv.id) },
  { label: 'Edit Group', icon: PhPencilSimple, onSelect: () => h.editGroup(conv.id) },
  { sep: true },
  { label: 'Copy Channel ID', icon: PhCopy, onSelect: () => h.copy(conv.id, 'Channel ID') },
  { sep: true },
  // Hide removes it from your sidebar without leaving; Leave actually exits the
  // group. Both were in the old ⋯ menu and neither should be lost.
  { label: 'Hide Group',  icon: PhX,       onSelect: () => h.hideGroup(conv.id) },
  { label: 'Leave Group', icon: PhSignOut, danger: true,
    onSelect: () => h.leaveGroup(conv.id) },
]
