/**
 * Call-bar tile menus: one for your own tile, one for everybody else's.
 *
 * Everything here that says "Mute", "Disable Video" or "User Volume" is LOCAL —
 * it changes what you hear and see, is never sent to the server, and the other
 * person is never told. That's deliberate, and it's why none of these need a
 * backend.
 *
 * Items in the reference screenshots that are deliberately absent, because a
 * row that does nothing is worse than no row:
 *   Apps, Soundboard          — no such subsystem in Skycord
 *   Pin / Mark As Read        — no backend (see the conversation menus)
 *   Add Note, Friend Nickname — no per-relationship data
 *   Invite to Server          — servers are mock data
 *   Ignore, Block             — no backend; Block needs its own design
 *   View Verification Code    — no E2EE
 *   Pop Out User              — deferred with the rest of pop-out
 *   Stop Ringing              — no per-callee ring state yet
 */
import {
  PhUser, PhMicrophoneSlash, PhHeadphones, PhVideoCameraSlash, PhCopy,
  PhEye, PhUsersThree, PhVideoCamera, PhSlidersHorizontal, PhUserMinus,
} from '@phosphor-icons/vue'
import type { MenuItem } from '../useContextMenu'
import type { MenuUser } from './userMenu'

export interface CallMenuHandlers {
  openProfile:    (u: MenuUser) => void
  previewCamera:  () => void
  toggleMute:     () => void
  toggleDeafen:   () => void
  openVoiceSettings: () => void
  copy:           (text: string, what: string) => void
  /** Per-participant local controls. */
  setUserVolume:  (id: string, v: number) => void
  toggleUserMute: (id: string) => void
  toggleUserVideo:(id: string) => void
  removeFriend?:  (id: string) => void
  /** Grid display prefs, shared with the ⋯ flyout. */
  toggleShowNonVideo: () => void
  toggleShowOwnCamera: () => void
}

export interface CallMenuState {
  selfMuted:      boolean
  selfDeafened:   boolean
  showNonVideo:   boolean
  showOwnCamera:  boolean
  channelId?:     string
}

/** Your own tile. */
export const ownTileMenu = (
  me: MenuUser, s: CallMenuState, h: CallMenuHandlers,
): MenuItem[] => [
  { label: 'Profile',        icon: PhUser,        onSelect: () => h.openProfile(me) },
  { label: 'Preview Camera', icon: PhVideoCamera, onSelect: () => h.previewCamera() },
  { sep: true },
  { label: 'Mute',   icon: PhMicrophoneSlash, check: s.selfMuted, keepOpen: true, onSelect: () => h.toggleMute() },
  { label: 'Deafen', icon: PhHeadphones,      check: s.selfDeafened, keepOpen: true, onSelect: () => h.toggleDeafen() },
  { label: 'Voice Settings', icon: PhSlidersHorizontal, onSelect: () => h.openVoiceSettings() },
  { sep: true },
  { label: 'Show Non-Video Participants', icon: PhUsersThree, check: s.showNonVideo, keepOpen: true,
    onSelect: () => h.toggleShowNonVideo() },
  { label: 'Show My Own Camera', icon: PhEye, check: s.showOwnCamera, keepOpen: true,
    onSelect: () => h.toggleShowOwnCamera() },
  { sep: true },
  { label: 'Copy User ID', icon: PhCopy, onSelect: () => h.copy(me.id, 'User ID') },
  ...(s.channelId
    ? [{ label: 'Copy Channel ID', icon: PhCopy, onSelect: () => h.copy(s.channelId!, 'Channel ID') }]
    : []),
]

/** Another participant's tile. */
export const participantMenu = (
  p: MenuUser,
  s: CallMenuState & { volume: number; muted: boolean; videoOff: boolean; isFriend?: boolean },
  h: CallMenuHandlers,
): MenuItem[] => [
  { label: 'Profile', icon: PhUser, onSelect: () => h.openProfile(p) },
  { sep: true },
  // 0–200%: above 100 is a real need when someone's mic is quiet, and it's the
  // only fix available from this side.
  { slider: true, label: 'User Volume', value: s.volume, min: 0, max: 200,
    format: v => `${v}%`, onInput: v => h.setUserVolume(p.id, v) },
  { sep: true },
  { label: 'Mute',          icon: PhMicrophoneSlash,  check: s.muted, keepOpen: true,
    onSelect: () => h.toggleUserMute(p.id) },
  { label: 'Disable Video', icon: PhVideoCameraSlash, check: s.videoOff, keepOpen: true,
    onSelect: () => h.toggleUserVideo(p.id) },
  { sep: true },
  { label: 'Show Non-Video Participants', icon: PhUsersThree, check: s.showNonVideo, keepOpen: true,
    onSelect: () => h.toggleShowNonVideo() },
  { sep: true },
  { label: 'Copy User ID', icon: PhCopy, onSelect: () => h.copy(p.id, 'User ID') },
  ...(s.channelId
    ? [{ label: 'Copy Channel ID', icon: PhCopy, onSelect: () => h.copy(s.channelId!, 'Channel ID') }]
    : []),
  ...(s.isFriend && h.removeFriend
    ? [{ sep: true } as MenuItem,
       { label: 'Remove Friend', icon: PhUserMinus, danger: true,
         onSelect: () => h.removeFriend!(p.id) } as MenuItem]
    : []),
]
