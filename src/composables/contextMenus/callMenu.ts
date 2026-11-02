/**
 * Call-bar tile menus: one for your own tile, one for everybody else's.
 *
 * Everything here that says "Mute", "Disable Video", "User Volume" or "Stream
 * Volume" is LOCAL —
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
 */
import {
  User, MicOff, Headphones, VideoOff, Copy, BellOff,
  Eye, UsersRound, Video, SlidersHorizontal, UserMinus, Phone,
} from 'lucide-vue-next'
import type { MenuItem, MenuSlider } from '../useContextMenu'
import type { MenuUser } from './userMenu'
import { USER_VOLUME_MAX } from '../remoteGain'

export interface CallMenuHandlers {
  openProfile:    (u: MenuUser) => void
  previewCamera:  () => void
  toggleMute:     () => void
  toggleDeafen:   () => void
  openVoiceSettings: () => void
  copy:           (text: string, what: string) => void
  /** Per-participant local controls. */
  setUserVolume:  (id: string, v: number) => void
  /** Their shared screen's sound, not their voice. */
  setStreamVolume:(id: string, v: number) => void
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
  { label: 'Profile',        icon: User,        onSelect: () => h.openProfile(me) },
  { label: 'Preview Camera', icon: Video, onSelect: () => h.previewCamera() },
  { sep: true },
  { label: 'Mute',   icon: MicOff, check: s.selfMuted, keepOpen: true, onSelect: () => h.toggleMute() },
  { label: 'Deafen', icon: Headphones,      check: s.selfDeafened, keepOpen: true, onSelect: () => h.toggleDeafen() },
  { label: 'Voice Settings', icon: SlidersHorizontal, onSelect: () => h.openVoiceSettings() },
  { sep: true },
  { label: 'Show Non-Video Participants', icon: UsersRound, check: s.showNonVideo, keepOpen: true,
    onSelect: () => h.toggleShowNonVideo() },
  { label: 'Show My Own Camera', icon: Eye, check: s.showOwnCamera, keepOpen: true,
    onSelect: () => h.toggleShowOwnCamera() },
  { sep: true },
  { label: 'Copy User ID', icon: Copy, onSelect: () => h.copy(me.id, 'User ID') },
  ...(s.channelId
    ? [{ label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(s.channelId!, 'Channel ID') }]
    : []),
]

/**
 * The person you're calling, before they pick up. They aren't in the call yet,
 * so none of the per-participant controls (volume, local mute, disable video)
 * have anything to act on — this menu is only about the ring itself.
 */
export const calleeMenu = (
  c: MenuUser,
  s: { ringing: boolean; channelId?: string },
  h: { ringAgain: () => void; stopRinging: () => void
       openProfile: (u: MenuUser) => void; copy: (t: string, w: string) => void },
): MenuItem[] => [
  { label: 'Profile', icon: User, onSelect: () => h.openProfile(c) },
  { sep: true },
  s.ringing
    ? { label: 'Stop Ringing', icon: BellOff, onSelect: () => h.stopRinging() }
    : { label: 'Ring Again',   icon: Phone,   onSelect: () => h.ringAgain() },
  { sep: true },
  { label: 'Copy User ID', icon: Copy, onSelect: () => h.copy(c.id, 'User ID') },
  ...(s.channelId
    ? [{ label: 'Copy Channel ID', icon: Copy,
         onSelect: () => h.copy(s.channelId!, 'Channel ID') } as MenuItem]
    : []),
]

/** Under User Volume when it stops at 100 %, so a slider halfway to its usual end does not read as broken. */
export const USER_VOLUME_CAPPED_HINT = 'Max 100% with this output device'

/**
 * User Volume: how loud this person's voice is for you. 0–200 %, because
 * past 100 is a real need when someone's mic is quiet, and the only fix
 * available from this side.
 *
 * `userVolumeMax` is 100 where going past 100 % would move their voice off
 * the output device you chose (useVoice's userVolumeMax, spec 12); then the
 * slider says why, and a stored 150 % shows as the 100 % that is heard.
 * Shared by both menus that offer it, so the two cannot drift.
 */
export const userVolumeRow = (
  id: string, s: { volume: number; userVolumeMax?: number },
  setUserVolume: (id: string, v: number) => void,
): MenuSlider => {
  const max = s.userVolumeMax ?? USER_VOLUME_MAX
  return {
    slider: true, label: 'User Volume', value: Math.min(s.volume, max), min: 0, max,
    format: v => `${v}%`, onInput: v => setUserVolume(id, v),
    ...(max < USER_VOLUME_MAX ? { hint: USER_VOLUME_CAPPED_HINT } : {}),
  }
}

/**
 * Stream Volume: the sound of the screen this person shares, apart from their
 * voice. Offered only while they share one WITH sound — a slider for a stream
 * that has none is a control with nothing behind it. 0–100, because it only
 * ever needs to go down (spec 12). Shared by both menus that offer User
 * Volume, so the two cannot drift.
 */
export const streamVolumeRow = (
  id: string, s: { streamVolume?: number; sharesScreenAudio?: boolean },
  setStreamVolume: (id: string, v: number) => void,
): MenuSlider[] => s.sharesScreenAudio
  ? [{ slider: true, label: 'Stream Volume', value: s.streamVolume ?? 100, min: 0, max: 100,
       format: v => `${v}%`, onInput: v => setStreamVolume(id, v) }]
  : []

/**
 * Every volume slider one person has, in order: User Volume, then Stream
 * Volume while they share a screen with sound. Both desktop menus and the
 * phone's person sheet draw exactly these, so none of the three can offer a
 * slider, a range or a hint the others do not.
 */
export const volumeSliders = (
  id: string,
  s: { volume: number; userVolumeMax?: number; streamVolume?: number; sharesScreenAudio?: boolean },
  h: Pick<CallMenuHandlers, 'setUserVolume' | 'setStreamVolume'>,
): MenuSlider[] => [userVolumeRow(id, s, h.setUserVolume), ...streamVolumeRow(id, s, h.setStreamVolume)]

/** Another participant's tile. */
export const participantMenu = (
  p: MenuUser,
  s: CallMenuState & {
    volume: number; muted: boolean; videoOff: boolean; isFriend?: boolean
    /** The User Volume slider's top: 200, or 100 where the output device cannot be kept past it. */
    userVolumeMax?: number
    /** Their Stream Volume, and whether they are sharing a screen with sound right now. */
    streamVolume?: number; sharesScreenAudio?: boolean
  },
  h: CallMenuHandlers,
): MenuItem[] => [
  { label: 'Profile', icon: User, onSelect: () => h.openProfile(p) },
  { sep: true },
  ...volumeSliders(p.id, s, h),
  { sep: true },
  { label: 'Mute',          icon: MicOff,  check: s.muted, keepOpen: true,
    onSelect: () => h.toggleUserMute(p.id) },
  { label: 'Disable Video', icon: VideoOff, check: s.videoOff, keepOpen: true,
    onSelect: () => h.toggleUserVideo(p.id) },
  { sep: true },
  { label: 'Show Non-Video Participants', icon: UsersRound, check: s.showNonVideo, keepOpen: true,
    onSelect: () => h.toggleShowNonVideo() },
  { sep: true },
  { label: 'Copy User ID', icon: Copy, onSelect: () => h.copy(p.id, 'User ID') },
  ...(s.channelId
    ? [{ label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(s.channelId!, 'Channel ID') }]
    : []),
  ...(s.isFriend && h.removeFriend
    ? [{ sep: true } as MenuItem,
       { label: 'Remove Friend', icon: UserMinus, danger: true,
         onSelect: () => h.removeFriend!(p.id) } as MenuItem]
    : []),
]
