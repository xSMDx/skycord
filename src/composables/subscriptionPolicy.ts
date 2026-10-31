/**
 * What this member downloads from a call, decided in one place.
 *
 * The room connects with autoSubscribe off, so nothing arrives that this
 * policy did not ask for. That used to be the other way round: everything
 * arrived, and a music-only sweep took back what was not wanted — except the
 * sweep ran before the room was registered, found nothing, and anyone who
 * joined a call with a song on heard it. Taking back after the fact is a race
 * by construction. Never asking is not.
 *
 * The price is that a voice is no longer automatic either: a mic nobody
 * subscribes is a person nobody can hear. So the rule for mic and camera is
 * the unconditional one, and useVoice applies the policy at every point a
 * publication can appear — connect, reconnect, a participant arriving, a
 * track being published — as well as whenever a choice changes.
 *
 * Pure: no room state of its own. useVoice owns the room and the choices
 * (`music.listeningTo`, `joinedStreams`) and passes them in.
 */
import { Track, type Room } from 'livekit-client'
import { MUSIC_IDENTITY } from './useMusic'

export type PubKind = 'mic' | 'camera' | 'screen' | 'screen-audio' | 'music'

/**
 * Which kind of thing a publication is.
 *
 * Identity first: the music service publishes every channel as a microphone
 * (music/src/publisher.ts), so read by source alone each song would count as
 * a voice and be subscribed for everyone.
 *
 * Anything a person publishes without a known source counts as their voice.
 * Nothing in Skycord does that today, but if something ever does, the side
 * to fail on is hearing it — not a person nobody can hear.
 */
export const kindOf = (pub: { source: Track.Source; trackName?: string }, identity: string): PubKind => {
  if (identity === MUSIC_IDENTITY) return 'music'
  switch (pub.source) {
    case Track.Source.Camera:           return 'camera'
    case Track.Source.ScreenShare:      return 'screen'
    case Track.Source.ScreenShareAudio: return 'screen-audio'
    default:                            return 'mic'
  }
}

/** The member's choices: which music channel they are tuned into, and whose streams they joined. */
export interface SubscriptionChoices {
  listeningTo: string | null
  /** Identities whose screen share this member chose to watch (Join stream). */
  joinedStreams: ReadonlySet<string>
}

/**
 * Whether to download one publication.
 *
 * - mic and camera: always. A person in the call is heard and seen.
 * - music: only the channel you are tuned into. A music track's name is its
 *   channel id. An empty name can never match, so "tuned into nothing" and
 *   "a track with no name" are not mistaken for each other.
 * - a screen and its audio: only after Join stream on that person's tile.
 *   They travel together; you join someone's stream, not half of it.
 */
export const shouldSubscribe = (
  kind: PubKind,
  ctx: SubscriptionChoices & { identity: string; trackName?: string },
): boolean => {
  switch (kind) {
    case 'mic':
    case 'camera':       return true
    case 'music':        return !!ctx.listeningTo && ctx.trackName === ctx.listeningTo
    case 'screen':
    case 'screen-audio': return ctx.joinedStreams.has(ctx.identity)
  }
}

/**
 * Set every remote publication in the room to what the policy wants.
 *
 * A sweep rather than one publication at a time, because the events that
 * call it do not all name a publication: Connected and Reconnected bring a
 * whole room of them at once, with no per-track event.
 *
 * Only a change is sent. `isDesired` is LiveKit's own record of what this
 * client last asked for, and with autoSubscribe off every publication starts
 * at false — so a song nobody tunes into never gets a request of any kind,
 * and the repeated sweeps cost nothing on the wire.
 */
export const applySubscriptions = (room: Room, ctx: SubscriptionChoices): void => {
  room.remoteParticipants.forEach((p) => {
    p.trackPublications.forEach((pub) => {
      const want = shouldSubscribe(kindOf(pub, p.identity), { ...ctx, identity: p.identity, trackName: pub.trackName })
      if (pub.isDesired !== want) pub.setSubscribed(want)
    })
  })
}
