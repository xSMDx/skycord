/**
 * Making server mute and server deafen actually true.
 *
 * ── Why this is not just a database write ───────────────────────────────────
 * LiveKit admits anyone holding a valid token and honours the grants baked into
 * it. So a mute recorded in Mongo silences nobody who is already connected —
 * their token still says `canPublish: true` and their microphone keeps working
 * until they happen to rejoin. That gap is the whole reason this file exists.
 *
 * Enforcement therefore has two halves, and BOTH are needed:
 *
 *   1. **The token**, minted in voiceController. This is the guaranteed half —
 *      it cannot be bypassed, because refusing to grant `canPublish` is the only
 *      thing that stops a client publishing. Every join and rejoin goes through
 *      it.
 *   2. **The live call**, here. This is the immediate half, and it is
 *      best-effort by nature: it talks to a media server over the network, which
 *      can be down, slow, or a version that answers differently.
 *
 * When the live half fails we fall back to evicting the participant, because a
 * reconnect is forced through the token — turning a failure to mute into a
 * brief disconnect rather than a mute that silently did not happen. If even
 * that fails, the persisted state still stands and the next join enforces it.
 * What must never happen is a moderator being told someone is muted while they
 * are still talking.
 */
import { RoomServiceClient, TrackType, TrackSource } from 'livekit-server-sdk'
import type { ResolvedVoice } from './resolveVoiceServer'
import { config } from '../config/env'

/**
 * RoomServiceClient speaks HTTP, while the URL we store is the one clients use
 * to open a WebSocket. `wss:` -> `https:` and `ws:` -> `http:`, leaving an
 * already-HTTP URL alone so a config that names one directly still works.
 */
export const adminUrl = (url: string): string => url.replace(/^ws/i, 'http')

export interface VoiceRestriction { mute: boolean; deafen: boolean }

export const NO_RESTRICTION: VoiceRestriction = { mute: false, deafen: false }

/**
 * Whether a restriction lets someone transmit.
 *
 * Deafen implies mute, deliberately. Someone who cannot hear the room cannot
 * follow it, and letting them keep transmitting into a conversation they are
 * deaf to serves nobody — it produces a person talking over others they cannot
 * hear. The two flags stay SEPARATE in storage so that lifting a deafen does
 * not silently lift a mute imposed on its own.
 */
export const canPublishUnder = (r: VoiceRestriction): boolean => !r.mute && !r.deafen
export const canSubscribeUnder = (r: VoiceRestriction): boolean => !r.deafen

/** What the channel's permissions say this person may do, before moderation. */
export interface VoicePermits { speak: boolean; video: boolean }

/**
 * The publish decision, in the shape both the token grant and a live permission
 * update need.
 *
 * `sources` is omitted when every source is allowed, and that omission matters:
 * `canPublishSources` SUPERSEDES `canPublish` in LiveKit, so an empty array is
 * not "no restriction" but "nothing at all". Absent means unrestricted; present
 * means exactly this list.
 */
export interface PublishGrant {
  canPublish: boolean
  canSubscribe: boolean
  sources?: TrackSource[]
}

/**
 * Fold the channel's permissions together with any moderation into one grant.
 *
 * Two inputs that look similar and are not. A PERMISSION describes a capability
 * this person was never given; MODERATION is an intervention against someone
 * who has it. They differ in one visible place, deliberately:
 *
 *   - Lacking **Speak** costs the microphone. Screen-share audio still works,
 *     because that is an application's sound and belongs to Video.
 *   - Being **server muted** costs the microphone AND screen-share audio. The
 *     point of a mute is that the room stops hearing that person, and leaving
 *     them a second audio channel to talk through would make it decorative.
 *
 * Deafen removes everything, including subscription — see canPublishUnder.
 */
export const publishGrantFor = (
  permits: VoicePermits,
  restriction: VoiceRestriction,
): PublishGrant => {
  if (restriction.deafen) return { canPublish: false, canSubscribe: false }

  const mic = permits.speak && !restriction.mute
  const video = permits.video
  // Muting closes the screen-share-audio route; lacking Speak does not.
  const shareAudio = video && !restriction.mute

  if (!mic && !video) return { canPublish: false, canSubscribe: true }
  if (mic && video && shareAudio) return { canPublish: true, canSubscribe: true }

  const sources: TrackSource[] = []
  if (mic) sources.push(TrackSource.MICROPHONE)
  if (video) {
    sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE)
    if (shareAudio) sources.push(TrackSource.SCREEN_SHARE_AUDIO)
  }
  return { canPublish: true, canSubscribe: true, sources }
}

/** Everything allowed — the grant for a channel that restricts nothing. */
export const UNRESTRICTED_PERMITS: VoicePermits = { speak: true, video: true }

/**
 * The full permission set for a restriction.
 *
 * Every field is spelled out because LiveKit applies a permission update
 * ATOMICALLY — "all desired permissions would need to be set", per the SDK.
 * Sending only the two that changed would silently clear the rest, and the
 * first symptom would be someone who can no longer send data messages for
 * reasons nobody could trace back to a mute.
 */
const permissionFor = (g: PublishGrant) => ({
  canSubscribe:      g.canSubscribe,
  canPublish:        g.canPublish,
  // Not audio. Data is how the client signals things like speaking state, and
  // silencing someone's microphone is not a reason to break that.
  canPublishData:    true,
  // Empty here means "every source", matching the grant's own convention that
  // an absent list is unrestricted — NOT LiveKit's token semantics, where an
  // empty canPublishSources would forbid everything. The difference is why this
  // is spelled out rather than passed straight through.
  canPublishSources: g.sources ?? [],
  hidden:            false,
  recorder:          false,
  canUpdateMetadata: false,
  agent:             false,
})

/**
 * Where to reach a voice server's admin API.
 *
 * The instance's own server — the only one with no database row — can be
 * reached inside the deployment, which in the container stack is
 * http://livekit:7880. That avoids leaving the machine and coming back through
 * the public address: wasteful in a container, and it fails outright behind a
 * router without NAT loopback. A server somebody registered lives elsewhere, so
 * only its own URL can be right.
 */
export const adminUrlFor = (voice: ResolvedVoice, internal = config.livekit.adminUrl): string =>
  voice.id === null && internal ? internal : adminUrl(voice.url)

const clientFor = (voice: ResolvedVoice) =>
  new RoomServiceClient(adminUrlFor(voice), voice.apiKey, voice.apiSecret)

/**
 * What happened, so the caller can be honest with the moderator rather than
 * assuming success. `absent` is not a failure: someone who is not in the call
 * needs no live enforcement, and their next join will read the persisted state.
 */
export type LiveOutcome = 'applied' | 'absent' | 'evicted' | 'failed'

/**
 * Apply a restriction to a live participant.
 *
 * Silences an open microphone as well as revoking the permission: revoking
 * alone leaves the moderator watching a mute they were told had taken effect
 * while the track is still up, for however long the media server takes to act
 * on it. Muting the track first closes that window.
 */
export const applyLiveRestriction = async (
  voice: ResolvedVoice,
  room: string,
  identity: string,
  grant: PublishGrant,
): Promise<LiveOutcome> => {
  const svc = clientFor(voice)

  let present
  try {
    present = await svc.getParticipant(room, identity)
  } catch {
    // Not in the room, or the room does not exist. Either way there is no live
    // state to change and the persisted flags cover the next join.
    return 'absent'
  }

  try {
    const micAllowed = grant.canPublish
      && (grant.sources === undefined || grant.sources.includes(TrackSource.MICROPHONE))
    if (!micAllowed) {
      // Audio only. A screen share is not speech, and Discord's server mute
      // does not stop one — killing it here would be a second punishment
      // nobody asked for and no label describes.
      const audio = (present.tracks ?? []).filter(t => t.type === TrackType.AUDIO)
      for (const t of audio) {
        try { await svc.mutePublishedTrack(room, identity, t.sid, true) } catch { /* permission change below still applies */ }
      }
    }
    await svc.updateParticipant(room, identity, { permission: permissionFor(grant) })
    return 'applied'
  } catch (err) {
    console.error('[voice-moderation] live apply failed, evicting instead', err)
    // The fallback that keeps this honest: a reconnect is forced through the
    // token, which cannot be bypassed.
    try {
      await svc.removeParticipant(room, identity)
      return 'evicted'
    } catch (err2) {
      console.error('[voice-moderation] eviction also failed', err2)
      return 'failed'
    }
  }
}

/** Drop someone from a voice room. Their persisted restrictions are untouched:
 *  disconnecting is not muting, and they may rejoin immediately. */
export const evictFromVoice = async (
  voice: ResolvedVoice,
  room: string,
  identity: string,
): Promise<LiveOutcome> => {
  try {
    await clientFor(voice).removeParticipant(room, identity)
    return 'evicted'
  } catch (err) {
    // A participant who is not there is the outcome the caller wanted anyway,
    // so this is logged rather than surfaced as a failure to disconnect.
    console.error('[voice-moderation] disconnect failed', err)
    return 'failed'
  }
}
