/**
 * What plays, and in what order — and nothing else.
 *
 * No audio element, no fetch, no Vue. Every function takes a state and
 * returns a new one, so the whole of "what happens when I press next" can be
 * tested without a browser. The player in useMusicPlayer does what this
 * says; it does not decide anything itself.
 *
 * That split exists because of what came before it. The first player was a
 * list and an index, and every feature was bolted onto that: clicking a
 * track in the queue drawer called the same function as clicking a library
 * row, which rebuilt the queue from whatever the modal happened to be
 * showing. Search for something, open the queue, click the next song, and
 * the queue silently became the search results. Shuffle picked a random
 * track each time, so it repeated songs, never finished the list, and
 * "previous" in shuffle went somewhere random rather than back. None of that
 * was visible to a test, because there were none.
 *
 * ## The model
 *
 * It is the one people already know from Spotify, because that is the one
 * whose behaviour they will expect:
 *
 *  · A **context** — where playback came from: a playlist, all tracks, a
 *    search. Its tracks keep their natural order.
 *  · A **play order** over the context: the identity, or a shuffled
 *    permutation computed ONCE when shuffle is turned on. Shuffle is a
 *    decision about order, not a dice roll per track — which is what lets
 *    previous go back, lets the queue show what is coming, and guarantees
 *    every song plays once before any plays twice.
 *  · A **manual queue** — "Play next" and "Add to queue". It plays before the
 *    context continues, and the context position does not move while it does.
 *
 * Moving around never rebuilds any of it. Next, previous and jumping move a
 * position. Only starting a new context replaces the context.
 */

export type RepeatMode = 'off' | 'all' | 'one'

/** Where playback came from, named the way the user would name it. */
export interface QueueContext {
  /** Stable identity: 'library', 'playlist:<id>', 'search:<q>'. */
  key: string
  /** For the queue drawer: "Next from Late Nights". */
  label: string
}

export interface QueueState<T extends { id: string }> {
  context: QueueContext | null
  /** The context's tracks, natural order. Duplicates allowed — a playlist can
   *  hold one song twice — so positions are indices, never ids. */
  tracks: T[]
  /** Play order: indices into `tracks`. */
  order: number[]
  /** Index into `order` of where the context stands. -1 before it starts. */
  pos: number
  /** Explicitly queued. Plays before the context continues. */
  manual: T[]
  /** What is playing. Not always tracks[order[pos]]: it may be a manual item. */
  current: T | null
  /** Whether `current` came from the manual queue. */
  fromManual: boolean
  shuffle: boolean
  repeat: RepeatMode
}

/**
 * What the player should do with the result.
 *
 *  play     load it and play
 *  restart  same track, from the top
 *  cue      load it but stay paused — the end of a list, ready to go again
 *  stop     pause and leave things where they are
 */
export type Action = 'play' | 'restart' | 'cue' | 'stop'

export interface Step<T extends { id: string }> {
  state: QueueState<T>
  track: T | null
  action: Action
}

/** A random source in [0, 1). Injected so tests can be deterministic. */
export type Rng = () => number

/** How far into a track "previous" restarts it instead of going back. */
export const RESTART_AFTER_SEC = 3

export const emptyQueue = <T extends { id: string }>(): QueueState<T> => ({
  context: null, tracks: [], order: [], pos: -1, manual: [],
  current: null, fromManual: false, shuffle: false, repeat: 'off',
})

// ── helpers ─────────────────────────────────────────────────────────────────

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** Fisher–Yates. Returns a new array; the input is untouched. */
export const shuffled = <X>(xs: X[], rng: Rng): X[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** An order that starts with `first` and shuffles the rest behind it. */
const shuffledFrom = (n: number, first: number, rng: Rng): number[] =>
  [first, ...shuffled(range(n).filter(i => i !== first), rng)]

/** The context track at the current position, whatever is playing now. */
export const contextTrack = <T extends { id: string }>(s: QueueState<T>): T | null =>
  s.pos >= 0 && s.pos < s.order.length ? s.tracks[s.order[s.pos]] : null

const at = <T extends { id: string }>(s: QueueState<T>, pos: number): QueueState<T> => ({
  ...s, pos, current: s.tracks[s.order[pos]] ?? null, fromManual: false,
})

// ── starting ────────────────────────────────────────────────────────────────

/**
 * Begin playing a context from one of its tracks.
 *
 * With shuffle on, the clicked track goes first and the rest are shuffled
 * behind it — you asked for that song, so it plays, and what follows is
 * random. The manual queue survives: starting an album does not throw away
 * the songs you lined up.
 */
export const start = <T extends { id: string }>(
  s: QueueState<T>,
  tracks: T[],
  context: QueueContext,
  index: number,
  rng: Rng,
): Step<T> => {
  if (!tracks.length || index < 0 || index >= tracks.length) {
    return { state: s, track: null, action: 'stop' }
  }
  const order = s.shuffle ? shuffledFrom(tracks.length, index, rng) : range(tracks.length)
  const pos = s.shuffle ? 0 : index
  const state: QueueState<T> = {
    ...s, context, tracks: [...tracks], order, pos,
    current: tracks[index], fromManual: false,
  }
  return { state, track: state.current, action: 'play' }
}

// ── moving ──────────────────────────────────────────────────────────────────

/**
 * Forward: the end of a track, or the next button.
 *
 * The difference between the two matters in exactly one place. Repeat-one
 * replays a track that ENDED, but pressing next is a request to move on, and
 * a button that replays the same song is a button that does nothing.
 *
 * At the end of the list with repeat off, the first track is cued rather
 * than nothing happening: playback stops, but the player is ready to go
 * again from the top instead of sitting on a finished song.
 */
export const next = <T extends { id: string }>(
  s: QueueState<T>,
  reason: 'ended' | 'skip',
  rng: Rng,
): Step<T> => {
  if (reason === 'ended' && s.repeat === 'one' && s.current) {
    return { state: s, track: s.current, action: 'restart' }
  }

  if (s.manual.length) {
    const [head, ...rest] = s.manual
    return {
      state: { ...s, manual: rest, current: head, fromManual: true },
      track: head, action: 'play',
    }
  }

  if (!s.order.length) return { state: s, track: null, action: 'stop' }

  const nextPos = s.pos + 1
  if (nextPos < s.order.length) {
    const state = at(s, nextPos)
    return { state, track: state.current, action: 'play' }
  }

  // Off the end of the list.
  if (s.repeat === 'off') {
    const state = at(s, 0)
    return { state, track: state.current, action: 'cue' }
  }

  // Repeating: go round again. A shuffled list is reshuffled, but never so
  // that the song that just finished plays straight away a second time.
  let order = s.order
  if (s.shuffle && s.order.length > 1) {
    const last = s.order[s.pos]
    do { order = shuffled(range(s.tracks.length), rng) } while (order[0] === last)
  }
  const state = at({ ...s, order }, 0)
  return { state, track: state.current, action: 'play' }
}

/**
 * Back.
 *
 * Past the first few seconds this restarts the song — the convention every
 * player shares, because "previous" pressed halfway through a track almost
 * always means "again", and nobody means "the one before" by accident.
 *
 * From a manual item it returns to where the context was, since that is
 * what played before it. Going back never touches the manual queue.
 */
export const previous = <T extends { id: string }>(
  s: QueueState<T>,
  positionSec: number,
): Step<T> => {
  if (!s.current) return { state: s, track: null, action: 'stop' }
  if (positionSec > RESTART_AFTER_SEC) return { state: s, track: s.current, action: 'restart' }

  if (s.fromManual) {
    const back = contextTrack(s)
    if (!back) return { state: s, track: s.current, action: 'restart' }
    const state = { ...s, current: back, fromManual: false }
    return { state, track: back, action: 'play' }
  }

  if (s.pos > 0) {
    const state = at(s, s.pos - 1)
    return { state, track: state.current, action: 'play' }
  }
  if (s.repeat === 'all' && s.order.length > 1) {
    const state = at(s, s.order.length - 1)
    return { state, track: state.current, action: 'play' }
  }
  return { state: s, track: s.current, action: 'restart' }
}

/** A row in the queue drawer. */
export type QueueTarget =
  | { kind: 'manual'; index: number }
  | { kind: 'context'; orderIndex: number }

/**
 * Play something from the queue drawer.
 *
 * This is the function the drawer was missing. It moves the position, and
 * that is all it does: the context and the order stay exactly as they were,
 * which is what a person clicking "the third song up next" means.
 *
 * A manual item is taken out and played; the ones queued after it stay
 * queued, because clicking one song is not a request to discard the others.
 */
export const jump = <T extends { id: string }>(s: QueueState<T>, target: QueueTarget): Step<T> => {
  if (target.kind === 'manual') {
    const track = s.manual[target.index]
    if (!track) return { state: s, track: null, action: 'stop' }
    const manual = s.manual.filter((_, i) => i !== target.index)
    return { state: { ...s, manual, current: track, fromManual: true }, track, action: 'play' }
  }
  if (target.orderIndex < 0 || target.orderIndex >= s.order.length) {
    return { state: s, track: null, action: 'stop' }
  }
  const state = at(s, target.orderIndex)
  return { state, track: state.current, action: 'play' }
}

// ── shuffle and repeat ──────────────────────────────────────────────────────

/**
 * Turn shuffle on or off without interrupting the song that is playing.
 *
 * On: the current track stays put and everything after it is shuffled.
 * Off: back to natural order, positioned at the current track, so the next
 * song is the one that naturally follows it.
 */
export const setShuffle = <T extends { id: string }>(
  s: QueueState<T>,
  on: boolean,
  rng: Rng,
): QueueState<T> => {
  if (on === s.shuffle) return s
  if (!s.tracks.length || s.pos < 0) return { ...s, shuffle: on }
  const here = s.order[s.pos]
  return on
    ? { ...s, shuffle: true, order: shuffledFrom(s.tracks.length, here, rng), pos: 0 }
    : { ...s, shuffle: false, order: range(s.tracks.length), pos: here }
}

/** off → all → one → off: none, the list, this track. */
export const cycleRepeat = <T extends { id: string }>(s: QueueState<T>): QueueState<T> => ({
  ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
})

// ── the manual queue ────────────────────────────────────────────────────────

export const enqueue = <T extends { id: string }>(
  s: QueueState<T>,
  track: T,
  where: 'next' | 'last',
): QueueState<T> => ({
  ...s, manual: where === 'next' ? [track, ...s.manual] : [...s.manual, track],
})

export const unqueue = <T extends { id: string }>(s: QueueState<T>, index: number): QueueState<T> => ({
  ...s, manual: s.manual.filter((_, i) => i !== index),
})

export const clearManual = <T extends { id: string }>(s: QueueState<T>): QueueState<T> => ({
  ...s, manual: [],
})

/**
 * A track was deleted. Take every copy of it out of everything.
 *
 * The position is pulled back past any removed entry at or before it, so
 * that next lands on the song that slid into the gap rather than skipping
 * one. If the deleted track was playing, `current` empties and the caller
 * stops the audio.
 */
export const drop = <T extends { id: string }>(s: QueueState<T>, id: string): QueueState<T> => {
  const manual = s.manual.filter(t => t.id !== id)
  const gone = new Set(s.tracks.map((t, i) => (t.id === id ? i : -1)).filter(i => i >= 0))

  let { order, pos, tracks } = s
  if (gone.size) {
    // Old index -> new index, for the tracks that survive.
    const remap = new Map<number, number>()
    let n = 0
    s.tracks.forEach((_, i) => { if (!gone.has(i)) remap.set(i, n++) })

    const kept: number[] = []
    s.order.forEach((trackIndex, orderIndex) => {
      if (gone.has(trackIndex)) { if (orderIndex <= s.pos) pos -= 1 }
      else kept.push(remap.get(trackIndex)!)
    })
    order = kept
    tracks = s.tracks.filter((_, i) => !gone.has(i))
  }

  const lostCurrent = s.current?.id === id
  return {
    ...s, tracks, order, pos: Math.min(pos, order.length - 1), manual,
    current: lostCurrent ? null : s.current,
    fromManual: lostCurrent ? false : s.fromManual,
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

export interface UpNext<T extends { id: string }> {
  manual: T[]
  context: { track: T; orderIndex: number }[]
}

/**
 * What the drawer shows: the manual queue, then the rest of this pass
 * through the context, in the order it will actually play.
 *
 * Shuffled or not, that order is known — it was decided when shuffle was
 * turned on. It stops at the end of the list rather than showing repeat
 * going round again: an endless list says less than the repeat icon does.
 */
export const upNext = <T extends { id: string }>(s: QueueState<T>): UpNext<T> => ({
  manual: [...s.manual],
  context: s.order
    .slice(s.pos + 1)
    .map((trackIndex, i) => ({ track: s.tracks[trackIndex], orderIndex: s.pos + 1 + i })),
})

/**
 * What will play when this track ends, so the player can fetch it early.
 * Null when that is not knowable in advance — a reshuffle at the wrap.
 */
export const peek = <T extends { id: string }>(s: QueueState<T>): T | null => {
  if (s.repeat === 'one') return s.current
  if (s.manual.length) return s.manual[0]
  if (s.pos + 1 < s.order.length) return s.tracks[s.order[s.pos + 1]]
  if (!s.order.length) return null
  if (s.repeat === 'all' && s.shuffle) return null
  return s.tracks[s.order[0]]
}
