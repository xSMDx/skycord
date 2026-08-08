/**
 * The "a person" menu — the same items wherever a user appears: friend rows,
 * Active Now, the members panel, a message avatar, a call tile.
 *
 * Defined once as data so those surfaces each cost one line, and so the menu
 * can't drift between them. Surface-specific rows arrive through `ctx` rather
 * than by forking the menu.
 */
import {
  PhUser, PhChatDots, PhPhoneCall, PhCopy,
} from '@phosphor-icons/vue'
import type { MenuItem } from '../useContextMenu'

/** The shape every caller can supply — deliberately loose, since friends,
 *  group members and call participants are all different types today. */
export interface MenuUser {
  id:           string
  username?:    string
  displayName?: string
  avatar?:      string | null
  status?:      string
}

export interface UserMenuHandlers {
  openProfile: (u: MenuUser) => void
  openDM:      (u: MenuUser) => void | Promise<void>
  startCall:   (u: MenuUser) => void | Promise<void>
  copyId:      (id: string) => void
}

export interface UserMenuCtx {
  /** Hide "Message"/"Call" when we're already in that person's DM. */
  isCurrentDM?: boolean
  /** Yourself — no point offering to DM or call yourself. */
  isSelf?:      boolean
}

export const userMenu = (
  u: MenuUser,
  h: UserMenuHandlers,
  ctx: UserMenuCtx = {},
): MenuItem[] => {
  const items: MenuItem[] = [
    { label: 'Profile', icon: PhUser, onSelect: () => h.openProfile(u) },
  ]

  if (!ctx.isSelf) {
    items.push(
      { label: 'Message', icon: PhChatDots, disabled: ctx.isCurrentDM,
        onSelect: () => void h.openDM(u) },
      { label: 'Call', icon: PhPhoneCall,
        onSelect: () => void h.startCall(u) },
    )
  }

  items.push(
    { sep: true },
    { label: 'Copy User ID', icon: PhCopy, onSelect: () => h.copyId(u.id) },
  )

  // Block is NOT here: Friendship.status has 'blocked' in the enum but nothing
  // writes or reads it, so the row would lie.
  //
  // Remove Friend is a different case — DELETE /users/friends/:userId exists and
  // callMenu already offers it. It belongs here too; it just needs a confirm
  // step first, since this menu opens on rows people click by accident.
  return items
}
