/**
 * Music channels inside a voice channel.
 *
 * Several streams at once in one call: two people on one, two on another,
 * everyone still talking. A member is tuned into at most one, and that choice
 * is theirs alone — it changes which LiveKit track they subscribe to and
 * nothing about what anybody else hears.
 *
 * This owns the state and the socket traffic. The subscription itself lives
 * in useVoice, next to the room, because that is where tracks are.
 */
import { reactive, computed, ref } from 'vue'
import { getSocket } from './useSocket'

/**
 * The music service's participant identity, and it must match the server's.
 *
 * Not a shared constant because the client and the server compile under
 * different tsconfigs and have never imported from each other. The colon is
 * what makes it safe to compare against: member identities are Mongo
 * ObjectIds, set server-side in the LiveKit token, so no member can ever
 * hold a name shaped like this one.
 */
import { soundMusicOpen, soundMusicTune, soundMusicLeave } from './useSounds'
import { onYield, takeAudio, release } from './audioFocus'

// Starting a local preview leaves whatever channel you were tuned into:
// the two are the same ear. See audioFocus.ts.
onYield('channel', () => { if (music.listeningTo) listenToMusic(null) })

export const MUSIC_IDENTITY = 'svc:music'

/**
 * Off until something can actually play.
 *
 * Phase 1 is built either side of a gap: the API tracks music channels and
 * the publisher can put audio into a room, but nothing joins the two. There
 * is no entry point in music/src, no Dockerfile, and nothing calls
 * publisher.open or publisher.play. Rendering the panel today would give
 * every member in a call a Music section they can create channels in and
 * hear nothing from, which is worse than not having the feature.
 *
 * Flip this when the service runs end to end. At that point it should stop
 * being a constant and become a capability the SERVER reports, because
 * whether music works depends on whether the host runs the container — not
 * on which client build they loaded. Not the public /instance profile
 * though: that document is unauthenticated and cached, and describes who an
 * instance is rather than what it can do.
 */
/**
 * Whether this instance can play music, as the server reported it.
 *
 * Not a build-time constant: whether music works depends on whether the
 * host runs the music container, and two members of the same instance
 * loading different client builds must not disagree about it. Set from the
 * voice token response when a call is joined, which is the moment it starts
 * to matter and the last moment it could change.
 */
export const musicAvailable = ref(false)

export interface MusicChannelView {
  id: string
  name: string
  /** `url` is null for a library track; `title` is null for a bare link. */
  now: { url: string | null; title: string | null; addedBy: string } | null
  queued: number
  listeners: string[]
}

export const music = reactive({
  /** Every channel in the current call. */
  channels: [] as MusicChannelView[],
  /** The one this member is tuned into, by id, or null. */
  listeningTo: null as string | null,
  /** Independent of voice volume. 0–1. */
  volume: 0.6,
  /** The last refusal, for showing next to the control that caused it. */
  error: '' as string,
})

export const musicChannel = computed(() =>
  music.channels.find(c => c.id === music.listeningTo) ?? null)

/** Where we are, for every emit. Set by useVoice when a call is joined. */
let target: { conversationId: string; kind: 'dm' | 'group' | 'channel' } | null = null

export const setMusicTarget = (t: typeof target): void => {
  if (t?.conversationId === target?.conversationId && t?.kind === target?.kind) return
  target = t
  // Leaving a call leaves its music. The server forgets us too; this is the
  // half the client owns, so a stale panel never outlives the call.
  if (!t) { music.channels = []; music.listeningTo = null; music.error = '' }
}

const send = (event: string, extra: Record<string, unknown> = {}): void => {
  if (!target) return
  getSocket()?.emit(event, { ...target, ...extra })
}

/**
 * Start a channel from a library track, or from a pasted link.
 *
 * A library track travels as an id, never as a URL. The server checks the
 * caller owns it and the service composes the address from its own
 * configuration, so there is no link for anyone to point somewhere else.
 */
/**
 * Tune into the channel this create is about to produce.
 *
 * You started it to hear it with people, so hearing nothing afterwards
 * reads as a failure. The id does not exist yet — the server answers a
 * create with a music:state rather than an ack — so the flag is spent on
 * the next state that brings a channel we did not have.
 */
let tuneIntoNext = false

export const createMusicChannel = (
  name: string,
  source: { trackId: string } | { url: string },
  thenListen = true,
): void => {
  tuneIntoNext = thenListen
  send('music:create', { name, ...source })
}

export const queueMusic = (channelId: string, source: { trackId: string } | { url: string }): void =>
  send('music:queue', { channelId, ...source })

export const skipMusic = (channelId: string): void =>
  send('music:skip', { channelId })

export const closeMusicChannel = (channelId: string): void =>
  send('music:close', { channelId })

/**
 * Tune in, or out with null.
 *
 * `listeningTo` is set optimistically so the row responds to the tap rather
 * than to the round trip — a 150ms wait on a toggle reads as a broken
 * button. The server's next `music:state` is authoritative and will correct
 * it if the channel turned out to be gone.
 */
export const listenToMusic = (channelId: string | null): void => {
  // Played on the way out, not on the way back from the server: tuning in is
  // a local decision that takes effect immediately, and a cue that waits for
  // a round trip lands after the audio it was meant to introduce.
  if (channelId !== music.listeningTo) (channelId ? soundMusicTune : soundMusicLeave)()
  if (channelId) takeAudio('channel'); else release('channel')
  music.listeningTo = channelId
  send('music:listen', { channelId })
}

/** Wired once, by useSocket, on every connect. */
export const onMusicState = (payload: { channels: MusicChannelView[] }): void => {
  const before = new Set(music.channels.map(c => c.id))
  music.channels = payload?.channels ?? []

  /*
   * A channel that is new to us gets the cue. Compared by id against what we
   * had rather than driven off the create call, because the event everyone
   * in the room needs to hear is somebody ELSE starting music — the person
   * who started it already knows.
   *
   * `before.size` guards the first state after joining a call: arriving in a
   * room with three channels already open must not fire three cues.
   */
  const fresh = music.channels.filter(c => !before.has(c.id))
  if (before.size && fresh.length) soundMusicOpen()

  // Exactly one new channel, and we asked for it: that is ours.
  if (tuneIntoNext && fresh.length === 1) {
    tuneIntoNext = false
    listenToMusic(fresh[0].id)
  }
  // A channel that went away while we were listening to it leaves us tuned
  // to nothing, rather than to an id nobody has.
  if (music.listeningTo && !music.channels.some(c => c.id === music.listeningTo)) {
    music.listeningTo = null
  }
}

export const onMusicError = (payload: { reason: string }): void => {
  music.error = payload?.reason ?? 'That did not work.'
}

export const clearMusicError = (): void => { music.error = '' }
