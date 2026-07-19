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
  PhUser, PhPhoneCall, PhPushPin, PhPushPinSlash, PhBellSlash, PhBell,
  PhX, PhTrash, PhCopy, PhSignOut, PhPencilSimple, PhLink,
} from '@phosphor-icons/vue'
import type { MenuItem } from '../useContextMenu'
import type { MenuUser } from './userMenu'
import { convPref, MUTE_OPTIONS } from '../useConvPrefs'

interface ConvActions {
  setPinned: (convId: string, pinned: boolean) => void
  setMute:   (convId: string, mute: string | null) => void
  copy:      (text: string, what: string) => void
}

export interface DMMenuHandlers extends ConvActions {
  openProfile: (u: MenuUser) => void
  startCall:   (u: MenuUser) => void | Promise<void>
  closeDM:     (convId: string) => void
  deleteDM:    (convId: string) => void
}

export interface GroupMenuHandlers extends ConvActions {
  openInvites: (convId: string) => void
  editGroup:   (convId: string) => void
  hideGroup:   (convId: string) => void
  leaveGroup:  (convId: string) => void
}

/**
 * Pin and Mute, shared by both conversation menus.
 *
 * Mute collapses to a single "Unmute" row when already muted — offering the
 * duration list again would imply you're choosing a NEW mute rather than
 * ending the current one.
 */
const pinAndMute = (convId: string, h: ConvActions): MenuItem[] => {
  const p = convPref(convId)
  return [
    p.pinned
      ? { label: 'Unpin Conversation', icon: PhPushPinSlash, onSelect: () => h.setPinned(convId, false) }
      : { label: 'Pin Conversation',   icon: PhPushPin,      onSelect: () => h.setPinned(convId, true) },
    p.muted
      ? { label: 'Unmute Conversation', icon: PhBell, onSelect: () => h.setMute(convId, null) }
      : {
          label: 'Mute Conversation', icon: PhBellSlash,
          submenu: MUTE_OPTIONS.map(o => ({
            label: o.label,
            onSelect: () => h.setMute(convId, o.value()),
          })),
        },
  ]
}

export const dmMenu = (
  // `id` is the partner's user id — the convPrefs key and what the sidebar uses.
  // `channelId` is the real conversation id, only needed for Copy Channel ID.
  conv: { id: string; channelId: string; user: MenuUser },
  h: DMMenuHandlers,
): MenuItem[] => [
  ...pinAndMute(conv.id, h),
  { sep: true },
  { label: 'Profile',      icon: PhUser,      onSelect: () => h.openProfile(conv.user) },
  { label: 'Start a Call', icon: PhPhoneCall, onSelect: () => void h.startCall(conv.user) },
  { sep: true },
  { label: 'Copy User ID',    icon: PhCopy, onSelect: () => h.copy(conv.user.id, 'User ID') },
  { label: 'Copy Channel ID', icon: PhCopy, onSelect: () => h.copy(conv.channelId, 'Channel ID') },
  { sep: true },
  { label: 'Close DM', icon: PhX, onSelect: () => h.closeDM(conv.id) },
  { label: 'Delete Conversation', icon: PhTrash, danger: true,
    onSelect: () => h.deleteDM(conv.id) },
]

export const groupMenu = (
  conv: { id: string },
  h: GroupMenuHandlers,
): MenuItem[] => [
  ...pinAndMute(conv.id, h),
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
