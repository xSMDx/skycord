/**
 * Right-clicking someone sitting in a voice channel, in the sidebar.
 *
 * Distinct from `callMenu`, which serves the call-bar TILES. The two look
 * similar and are not interchangeable: the tile menus carry grid preferences
 * ("Show Non-Video Participants", "Show My Own Camera") that describe how the
 * call stage lays itself out, and a sidebar row has no stage to lay out. What
 * they do share — the local volume/mute/video controls — is shared by taking
 * the same handler interface rather than by copying rows.
 *
 * **Local means local.** User Volume, Stream Volume, Mute, Disable Video and
 * Join / Leave stream here change only what THIS client hears and shows. Nothing is sent, and the other person is
 * never told.
 *
 * **Server Mute, Server Deafen and Disconnect are the opposite** and are
 * separated by a divider for exactly that reason: they act on somebody else's
 * client, they persist, and everyone in the server is told. They appear only
 * for a moderator who actually holds the bit AND outranks the person — the
 * server enforces both again, so a client that shows a row it should not can
 * still not use it, but a row that always 403s is a lie the menu should not
 * tell in the first place.
 *
 * Rows in the reference that are absent because there is nothing behind them:
 *   Mention, Add Note      — no composer insertion API, no per-relationship data
 *   Mute Soundboard, Apps  — no such subsystem
 *   Ignore, Block          — no backend; Block needs its own design
 *   Move to                — no move-participant endpoint yet (Disconnect is the
 *                            half of MoveMembers that is built)
 *   Edit Per-server Profile — no per-server profile
 * A row that cannot work is worse than a row that is not there, which is the
 * rule the rest of this menu family follows.
 */
import {
  User, MicOff, Headphones, VideoOff, Copy, MessageCircle, Phone,
  UserPlus, SlidersHorizontal, Volume2, HeadphoneOff, PhoneOff,
} from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'
import type { MenuUser } from './userMenu'
import { volumeSliders, streamJoinRow } from './callMenu'

export interface VoiceOccupantHandlers {
  openProfile:    (u: MenuUser) => void
  openDM:         (u: MenuUser) => void | Promise<void>
  startCall:      (u: MenuUser) => void | Promise<void>
  inviteToServer: (u: MenuUser) => void
  addFriend?:     (u: MenuUser) => void
  copy:           (text: string, what: string) => void
  /** Per-participant, local to this client. */
  setUserVolume:  (id: string, v: number) => void
  /** Their shared screen's sound, not their voice. */
  setStreamVolume:(id: string, v: number) => void
  toggleUserMute: (id: string) => void
  toggleUserVideo:(id: string) => void
  /** Start or stop loading their shared screen (useVoice's joinStream / leaveStream). */
  joinStream:     (id: string) => void
  leaveStream:    (id: string) => void
  /** Your own controls, for the self menu. */
  toggleMute:     () => void
  toggleDeafen:   () => void
  openVoiceSettings: () => void
  /** Moderation. Unlike everything above, these reach the server. */
  setServerMute?:   (u: MenuUser, next: boolean) => void | Promise<void>
  setServerDeafen?: (u: MenuUser, next: boolean) => void | Promise<void>
  disconnectFromVoice?: (u: MenuUser) => void | Promise<void>
}

export interface VoiceOccupantState {
  channelId: string
  /** Local playback state for this participant. */
  volume:    number
  muted:     boolean
  videoOff:  boolean
  /** The User Volume slider's top: 200, or 100 where the output device cannot be kept past it. */
  userVolumeMax?: number
  /** Their Stream Volume, and whether they share a screen with sound right now. */
  streamVolume?:      number
  sharesScreenAudio?: boolean
  /** Whether they share a screen right now, and whether you joined it. */
  sharing?:      boolean
  joinedStream?: boolean
  isFriend?: boolean
  /** Whether this client can actually act on them — i.e. we share the call.
   *  Volume and local mute have nothing to act on otherwise. */
  inCallWithThem?: boolean
  /** What has been imposed on them, so the rows read as toggles rather than
   *  as commands whose current state you have to guess. */
  serverMuted?:   boolean
  serverDeafened?: boolean
  /** Whether THIS viewer may impose each one. Resolved from the permission
   *  model plus role position — see canModerateVoice in ChatApp. */
  canServerMute?:   boolean
  canServerDeafen?: boolean
  canDisconnect?:   boolean
}

/** Somebody else, sitting in a voice channel. */
export const voiceOccupantMenu = (
  u: MenuUser,
  s: VoiceOccupantState,
  h: VoiceOccupantHandlers,
): MenuItem[] => {
  const items: MenuItem[] = [
    { label: 'Profile', icon: User, onSelect: () => h.openProfile(u) },
    { label: 'Message', icon: MessageCircle, onSelect: () => void h.openDM(u) },
    { label: 'Start a Call', icon: Phone, onSelect: () => void h.startCall(u) },
  ]

  // Volume and local mute act on an audio element that only exists while you
  // are both in the same room. Offering them from a channel you are merely
  // looking at would be a control with nothing behind it.
  if (s.inCallWithThem) {
    items.push(
      { sep: true },
      ...volumeSliders(u.id, s, h),
      { label: 'Mute', icon: MicOff, check: s.muted, keepOpen: true,
        onSelect: () => h.toggleUserMute(u.id) },
      { label: 'Disable Video', icon: VideoOff, check: s.videoOff, keepOpen: true,
        onSelect: () => h.toggleUserVideo(u.id) },
    )
    // The way into their shared screen from the people list, and out again.
    const stream = streamJoinRow(u.id, { sharing: !!s.sharing, joined: !!s.joinedStream }, h)
    if (stream.length) items.push({ sep: true }, ...stream)
  }

  /*
   * Moderation, in its own block.
   *
   * Server Mute reads as a toggle rather than two rows, because "un-mute" as a
   * separate command invites the question of what happens when you pick it on
   * somebody who is not muted. Disconnect is not a toggle and is last, below
   * the reversible pair — it is the one row here that ends something.
   */
  const canModerate = s.canServerMute || s.canServerDeafen || s.canDisconnect
  if (canModerate) {
    items.push({ sep: true })
    if (s.canServerMute && h.setServerMute) {
      items.push({
        label: 'Server Mute', icon: MicOff, check: !!s.serverMuted, keepOpen: true,
        onSelect: () => void h.setServerMute!(u, !s.serverMuted),
      })
    }
    if (s.canServerDeafen && h.setServerDeafen) {
      items.push({
        label: 'Server Deafen', icon: HeadphoneOff, check: !!s.serverDeafened, keepOpen: true,
        onSelect: () => void h.setServerDeafen!(u, !s.serverDeafened),
      })
    }
    // Only while they are actually in a call with us to disconnect them FROM —
    // the endpoint is idempotent, but a row that always no-ops is still noise.
    if (s.canDisconnect && h.disconnectFromVoice) {
      items.push({
        label: 'Disconnect', icon: PhoneOff, danger: true,
        onSelect: () => void h.disconnectFromVoice!(u),
      })
    }
  }

  items.push({ sep: true }, { label: 'Invite to Server', icon: UserPlus, onSelect: () => h.inviteToServer(u) })
  if (h.addFriend && !s.isFriend) {
    items.push({ label: 'Add Friend', icon: UserPlus, onSelect: () => h.addFriend!(u) })
  }

  items.push(
    { sep: true },
    { label: 'Copy User ID', icon: Copy, onSelect: () => h.copy(u.id, 'User ID') },
    { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(s.channelId, 'Channel ID') },
  )
  return items
}

/** Your own row in a voice channel. */
export const voiceSelfMenu = (
  me: MenuUser,
  s: { channelId: string; selfMuted: boolean; selfDeafened: boolean },
  h: VoiceOccupantHandlers,
): MenuItem[] => [
  { label: 'Profile', icon: User, onSelect: () => h.openProfile(me) },
  { sep: true },
  { label: 'Mute',   icon: MicOff,     check: s.selfMuted,    keepOpen: true, onSelect: () => h.toggleMute() },
  { label: 'Deafen', icon: Headphones, check: s.selfDeafened, keepOpen: true, onSelect: () => h.toggleDeafen() },
  { label: 'Voice Settings', icon: SlidersHorizontal, onSelect: () => h.openVoiceSettings() },
  { sep: true },
  { label: 'Copy User ID', icon: Copy, onSelect: () => h.copy(me.id, 'User ID') },
  { label: 'Copy Channel ID', icon: Copy, onSelect: () => h.copy(s.channelId, 'Channel ID') },
]

/** Exported for the sidebar, which shows the same speaker glyph. */
export const VOICE_MENU_ICON = Volume2
