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
import { isPaused, canPause } from './musicPause'

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

/** One entry as a listener sees it. A bare link has no title to show. */
export interface MusicEntryView {
  /** Stable for as long as the entry is queued. What "play now" names. */
  id: string
  kind: 'link' | 'library'
  title: string | null
  artist: string | null
  durationSec: number | null
  addedBy: string
}

export interface MusicChannelView {
  id: string
  name: string
  now: (MusicEntryView & {
    url: string | null
    cover: string | null
    /** How far in at the moment the server built this. See channelElapsed. */
    elapsedMs: number | null
  }) | null
  /** What plays after it, in order. */
  queue: MusicEntryView[]
  queued: number
  listeners: string[]
  /** Whether there is a song to go back to. */
  previous: boolean
  /**
   * Paused for everyone; `now.elapsedMs` is then the frozen point. An older
   * server sends none, which is a song playing — read it through isPaused.
   */
  paused?: boolean
  /**
   * Present, and true, only when the server's music service can pause. Its
   * absence is the whole compatibility story: no surface offers Pause
   * without it. Read it through canPause.
   */
  pausable?: boolean
}

export { isPaused, canPause }

export const music = reactive({
  /** Every channel in the current call. */
  channels: [] as MusicChannelView[],
  /** The one this member is tuned into, by id, or null. */
  listeningTo: null as string | null,
  /** Independent of voice volume. 0–1. */
  volume: 0.6,
  /** The last refusal, for showing next to the control that caused it. */
  error: '' as string,
  /** When the last state arrived, by this machine's clock. See channelElapsed. */
  receivedAt: 0,
})

/**
 * Seconds into a channel's song, right now.
 *
 * The server says how far in it was when it built the state; this adds how
 * long ago, by THIS machine's clock, that state arrived. Neither side ever
 * reads the other's clock, so a laptop that is a minute fast still draws the
 * bar in the right place.
 *
 * Paused, the server's figure is the frozen point and nothing is added: the
 * bar stands still for as long as the song is held. Resume arrives as a new
 * state carrying that same point, received now, so the count picks up from
 * exactly where it stopped rather than jumping by the time it was held.
 */
export const channelElapsed = (c: MusicChannelView | null, nowMs: number): number | null => {
  if (!c?.now || c.now.elapsedMs === null) return null
  const since = isPaused(c) ? 0 : nowMs - music.receivedAt
  const sec = (c.now.elapsedMs + since) / 1000
  const d = c.now.durationSec
  return d ? Math.min(d, Math.max(0, sec)) : Math.max(0, sec)
}

/**
 * A once-a-second tick, running while anything in the call is playing.
 *
 * Progress for a shared song comes from no audio element — the sound
 * arrives through the call — so nothing fires timeupdate. Rather than every
 * view running its own interval, they all read this one, and it stops when
 * there is nothing to count.
 *
 * Not only while you are tuned in: the rail shows every channel's progress
 * so you can see what you would be joining, and a bar that only moves on
 * the one channel you already hear froze the others between updates.
 *
 * A held song counts nothing, so a call whose every song is paused stops it.
 */
export const musicNow = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
const tick = (on: boolean): void => {
  if (on && !ticker) ticker = setInterval(() => { musicNow.value = Date.now() }, 1000)
  if (!on && ticker) { clearInterval(ticker); ticker = null }
}
const syncTick = (): void => tick(music.channels.some(c => c.now !== null && !isPaused(c)))

/**
 * Stop listening without telling the server — for when the server already
 * knows, because the call ended or the channel closed.
 *
 * Kept apart from listenToMusic(null), which also sends, plays the leave
 * cue and is a choice the person made. These are the two ways listening
 * ends on its own, and both used to clear the id and nothing else: the
 * preview could not take the ear back because audioFocus still thought a
 * channel had it.
 */
const untune = (): void => {
  music.listeningTo = null
  release('channel')
}

export const musicChannel = computed(() =>
  music.channels.find(c => c.id === music.listeningTo) ?? null)

/** Where we are, for every emit. Set by useVoice when a call is joined. */
let target: { conversationId: string; kind: 'dm' | 'group' | 'channel' } | null = null
/** The server's name for that call's room — what music:state is labelled with. */
let targetRoom: string | null = null

/**
 * Every room's last state, by room.
 *
 * A voice channel's audience is the whole server, so this member receives
 * every call's music state, not only their own. Applying each as it came
 * made the rail flip to whichever call changed last. Kept rather than
 * dropped, because the server answers a join with the room's state and that
 * can arrive before useVoice has told us which call we are in.
 */
const byRoom = new Map<string, MusicChannelView[]>()

export const setMusicTarget = (t: typeof target, room: string | null = null): void => {
  if (t?.conversationId === target?.conversationId && t?.kind === target?.kind && room === targetRoom) return
  target = t
  targetRoom = t ? room : null
  // A pause asked in one call is no business of the next.
  settleAllPauses()
  // Leaving a call leaves its music. The server forgets us too; this is the
  // half the client owns, so a stale panel never outlives the call.
  if (!t) { music.channels = []; untune(); syncTick(); music.error = ''; return }
  if (room && byRoom.has(room)) {
    music.receivedAt = Date.now()
    music.channels = byRoom.get(room)!
    syncTick()
  }
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

/**
 * Put one of your tracks on a channel, and listen to that channel.
 *
 * Sharing is "let's hear this together", so it moves your ear to the room.
 * Leaving a preview running instead played the same song twice, a beat
 * apart — which sounds like a fault, not like sharing.
 */
export const shareToChannel = (channelId: string, trackId: string): void => {
  queueMusic(channelId, { trackId })
  if (music.listeningTo !== channelId) listenToMusic(channelId)
}

export const skipMusic = (channelId: string): void =>
  send('music:skip', { channelId })

/** Move the channel's song for everyone. Whole seconds: the server floors anyway. */
export const seekMusic = (channelId: string, sec: number): void =>
  send('music:seek', { channelId, sec: Math.floor(sec) })

/**
 * Pause, or resume, the channel's song for everyone — anyone who may skip may.
 *
 * Nothing is flipped here ahead of the server. It asks the music service
 * first and tells the room only once the audio has actually stopped, so a
 * control that said Paused while the song played on would be the one lie the
 * server is built to avoid. The press answers the tap; the state follows the
 * broadcast, as a skip's new title does, and a refusal leaves everything as
 * it was, with its reason in `music.error` like any other.
 *
 * That gap can be long — the server waits up to five seconds on the service
 * — and the control still reads Pause throughout. So one request per channel
 * is in flight at a time: a second tap would only be refused "It is already
 * paused." straight after a pause that worked, and spend a rate-limit token
 * doing it. See pausePending.
 */
export const pauseMusic = (channelId: string): void => askPause(channelId, true)

export const resumeMusic = (channelId: string): void => askPause(channelId, false)

/**
 * How long a pause or resume waits for an answer before the control takes
 * taps again: just past the server's five-second wait on the music service,
 * so it never gives up on an answer that is still allowed to come. Also how
 * long the composer lets a refusal replace a /pause note.
 */
export const PAUSE_SETTLE_MS = 6000

/**
 * The channels with a pause or resume on its way, by id — what each asked
 * for and which song it was asked about, so the answer can be recognised.
 * The set is what the controls read; the rest is bookkeeping.
 */
const pausing = reactive(new Set<string>())
const pauseWaits = new Map<string, { paused: boolean; entry: string | null; timer: ReturnType<typeof setTimeout> }>()

const settlePause = (channelId: string): void => {
  const w = pauseWaits.get(channelId)
  if (w) clearTimeout(w.timer)
  pauseWaits.delete(channelId)
  pausing.delete(channelId)
}
const settleAllPauses = (): void => { for (const id of [...pauseWaits.keys()]) settlePause(id) }

const askPause = (channelId: string, paused: boolean): void => {
  // No call, nothing sent — and so nothing to wait for.
  if (!target || pausing.has(channelId)) return
  send(paused ? 'music:pause' : 'music:resume', { channelId })
  pausing.add(channelId)
  pauseWaits.set(channelId, {
    paused,
    entry: music.channels.find(c => c.id === channelId)?.now?.id ?? null,
    timer: setTimeout(() => settlePause(channelId), PAUSE_SETTLE_MS),
  })
}

/**
 * A pause or resume is on its way for this channel. Not an optimistic flip:
 * the channel still shows what the server last said, and the control only
 * says it is busy and takes no second tap.
 *
 * It ends with the answer: a state that shows the channel paused (or
 * playing) as asked, or one where the song it was asked about has gone, or
 * the channel has; any refusal; leaving the call; or PAUSE_SETTLE_MS. Not on
 * any state at all, because the server broadcasts the whole list for every
 * change, and somebody queueing a song in the gap is not the answer.
 */
export const isPausePending = (c: MusicChannelView | null | undefined): boolean =>
  !!c && pausing.has(c.id)

/** The pause bookkeeping a new state answers. See isPausePending. */
const settlePausesFrom = (channels: MusicChannelView[]): void => {
  for (const [id, w] of pauseWaits) {
    const c = channels.find(x => x.id === id)
    if (!c || (c.now?.id ?? null) !== w.entry || isPaused(c) === w.paused) settlePause(id)
  }
}

/** Pause a playing channel or resume a held one — whichever it is now. Nothing for one that cannot, or that is waiting. */
export const togglePauseMusic = (c: MusicChannelView): void => {
  if (!canPause(c) || isPausePending(c)) return
  if (isPaused(c)) resumeMusic(c.id); else pauseMusic(c.id)
}

/** Back a song, or to the start of this one past three seconds, for everyone. */
export const previousMusic = (channelId: string): void =>
  send('music:previous', { channelId })

/** Play one queued song now, for everyone. By id, so a shifting queue cannot misfire it. */
export const playNowMusic = (channelId: string, entryId: string): void =>
  send('music:play-now', { channelId, entryId })

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
export const onMusicState = (payload: { room?: string; channels: MusicChannelView[] }): void => {
  if (payload?.room) {
    if (payload.channels?.length) byRoom.set(payload.room, payload.channels)
    else byRoom.delete(payload.room)
    // Somebody else's call, or no call at all: filed, not shown.
    if (payload.room !== targetRoom) return
  }
  music.receivedAt = Date.now()
  musicNow.value = music.receivedAt
  const before = new Set(music.channels.map(c => c.id))
  music.channels = payload?.channels ?? []
  syncTick()
  settlePausesFrom(music.channels)

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
    untune()
  }
}

export const onMusicError = (payload: { reason: string }): void => {
  // A refusal ends any wait: the server answers a refused pause with this and
  // nothing else, and it does not say which request it answers.
  settleAllPauses()
  music.error = payload?.reason ?? 'That did not work.'
}

export const clearMusicError = (): void => { music.error = '' }
