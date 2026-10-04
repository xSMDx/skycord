/**
 * The local music player.
 *
 * It decides nothing. What plays next, what previous means, what shuffle
 * does — all of that is musicQueue.ts, which is pure and tested. This file
 * does what the queue says: owns the one audio element, fetches and caches
 * the audio, tells the OS what is playing, and remembers where you were.
 *
 * ## The element belongs to the session, not to a view
 *
 * It is created with `new Audio()` and never attached to the document. It
 * used to live inside the music modal, so closing the modal stopped the
 * music and reopening it started the song over.
 *
 * ## Why the audio is fetched rather than given to `src`
 *
 * The stream route is behind requireAuth, which reads a Bearer header, and
 * an audio element cannot send one — so `src` pointing at the route 401s.
 * The bytes are fetched with the token and played from a blob.
 *
 * That means a song downloads before it plays, and that used to be audible
 * as a silent gap every time a song ended, or you skipped, or clicked a
 * queue entry. Two things close it: the next song is fetched while the
 * current one plays, and the last few songs stay cached, so going back is
 * instant.
 */
import { reactive, computed, watch } from 'vue'
import { useAuth } from './useAuth'
import { library, trackAudioUrl, type LibTrack } from './useMusicLibrary'
import { onYield, takeAudio, release as releaseFocus } from './audioFocus'
import * as Q from './musicQueue'

export type { RepeatMode, QueueContext, QueueTarget } from './musicQueue'

const rng: Q.Rng = Math.random

/** The queue, as musicQueue defines it. Replaced wholesale by each step. */
export const queue = reactive(Q.emptyQueue<LibTrack>()) as Q.QueueState<LibTrack>

const apply = (s: Q.QueueState<LibTrack>): void => { Object.assign(queue, s) }

/**
 * What the views read. `current`, `shuffle` and `repeat` are the queue's —
 * exposed as getters rather than copied, because a copy is a second source
 * of truth and the two would eventually disagree.
 */
export const player = reactive({
  get current(): LibTrack | null { return queue.current },
  get shuffle(): boolean { return queue.shuffle },
  get repeat(): Q.RepeatMode { return queue.repeat },
  paused: true,
  /** Seconds, from the element's own timeupdate. */
  at: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  /** The id being fetched, so its row can show it is working. */
  loadingId: null as string | null,
  error: '',
})

// ── the element ─────────────────────────────────────────────────────────────

let el: HTMLAudioElement | null = null
/** The object URL the element is playing. Never revoked while it is. */
let elUrl: string | null = null
/** A restored position, applied once the restored song actually loads. */
let pendingSeek: number | null = null
/** Consecutive failures, so an unplayable list stops instead of spinning. */
let failures = 0

const effectiveVolume = (): number => (player.muted ? 0 : player.volume)

/** Created on first use: most sessions never play anything. */
const element = (): HTMLAudioElement => {
  if (el) return el
  el = new Audio()
  el.preload = 'auto'
  el.volume = effectiveVolume()

  el.addEventListener('play', () => { player.paused = false; mediaState() })
  el.addEventListener('pause', () => { player.paused = true; mediaState(); persistSoon() })
  el.addEventListener('playing', () => { failures = 0 })
  el.addEventListener('timeupdate', onTime)
  el.addEventListener('loadedmetadata', () => {
    if (!el) return
    if (Number.isFinite(el.duration)) player.duration = el.duration
    if (pendingSeek !== null) { el.currentTime = pendingSeek; pendingSeek = null }
  })
  el.addEventListener('ended', () => { void act(Q.next(queue, 'ended', rng)) })
  el.addEventListener('error', () => {
    // Only a real decode failure of the song we chose. Clearing the source
    // on purpose fires this too, and that is not a failure.
    if (el?.src && el.src === elUrl && queue.current) onFailure(queue.current)
  })
  return el
}

// Tuning into a music channel stops the preview — one thing at a time.
onYield('preview', () => { el?.pause() })

// ── fetching and the cache ──────────────────────────────────────────────────

/**
 * The last few songs, by id, as object URLs.
 *
 * Six makes previous, re-jumping and a short repeat instant, and costs tens
 * of megabytes at Opus bitrates rather than hundreds. Map iteration order is
 * insertion order, so re-inserting on use makes this least-recently-used
 * without a second structure.
 */
const MAX_CACHED = 6
const cache = new Map<string, string>()

interface Load { promise: Promise<string>; ctrl: AbortController }
const loads = new Map<string, Load>()

/** The two songs worth downloading right now. Anything else is aborted. */
let wantPlay: string | null = null
let wantNext: string | null = null

const remember = (id: string, url: string): void => {
  cache.delete(id)
  cache.set(id, url)
  for (const [oldId, oldUrl] of cache) {
    if (cache.size <= MAX_CACHED) break
    if (oldUrl === elUrl || oldId === wantPlay || oldId === wantNext) continue
    URL.revokeObjectURL(oldUrl)
    cache.delete(oldId)
  }
}

/**
 * One download per song, however many callers want it.
 *
 * The prefetch and a click usually ask for the same song at the same moment
 * — prefetch fetches exactly what you are about to want — so they share one
 * request rather than racing two.
 */
const urlFor = (t: LibTrack): Promise<string> => {
  const hit = cache.get(t.id)
  if (hit) { remember(t.id, hit); return Promise.resolve(hit) }
  const pending = loads.get(t.id)
  if (pending) return pending.promise

  const ctrl = new AbortController()
  const promise = (async () => {
    const { accessToken } = useAuth()
    const res = await fetch(trackAudioUrl(t.id), {
      headers: accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {},
      credentials: 'include',
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const url = URL.createObjectURL(await res.blob())
    remember(t.id, url)
    return url
  })()
  loads.set(t.id, { promise, ctrl })
  promise
    .finally(() => { if (loads.get(t.id)?.promise === promise) loads.delete(t.id) })
    .catch(() => { /* reported by whoever awaited it */ })
  return promise
}

/**
 * Abort what nobody wants any more. Mashing next ten times should download
 * the song you landed on, not all ten.
 */
const sweep = (): void => {
  for (const [id, l] of loads) if (id !== wantPlay && id !== wantNext) l.ctrl.abort()
}

/** Start downloading whatever will play when this song ends. */
const prefetch = (): void => {
  const n = Q.peek(queue)
  wantNext = n?.id ?? null
  sweep()
  if (n && !cache.has(n.id)) urlFor(n).catch(() => { /* retried when reached */ })
}

// ── doing what the queue says ───────────────────────────────────────────────

let seq = 0

const safePlay = async (): Promise<void> => {
  if (!el?.src) return
  takeAudio('preview')
  try { await el.play() } catch { player.paused = true }
}

const act = async (step: Q.Step<LibTrack>): Promise<void> => {
  apply(step.state)
  const a = element()
  const t = step.track

  if (step.action === 'stop' || !t) { a.pause(); persistSoon(); return }
  if (step.action === 'restart') { a.currentTime = 0; await safePlay(); return }

  const mine = ++seq
  wantPlay = t.id
  sweep()
  if (step.action === 'play') takeAudio('preview')
  player.error = ''

  const cached = cache.get(t.id)
  player.loadingId = cached ? null : t.id
  // A different song stops now rather than playing on under a spinner: you
  // asked for something else. A cached one swaps with no gap at all.
  if (!cached || cached !== elUrl) a.pause()

  try {
    const url = await urlFor(t)
    if (mine !== seq) return
    if (elUrl !== url) { a.src = url; elUrl = url }
    player.at = 0
    player.duration = t.durationSec
    mediaMeta(t)
    if (step.action === 'play') await a.play()
    else a.currentTime = 0
    persistSoon()
    prefetch()
  } catch (err) {
    if (mine !== seq || (err as Error)?.name === 'AbortError') return
    onFailure(t)
  } finally {
    if (mine === seq) player.loadingId = null
  }
}

const onFailure = (t: LibTrack): void => {
  failures++
  player.error = `“${t.title}” could not be played.`
  player.paused = true
  // Skip it, but not forever: if everything fails — the server is down, the
  // session expired — the list has to stop rather than spin through itself.
  if (failures < 3 && queue.current?.id === t.id) void act(Q.next(queue, 'skip', rng))
}

/** After anything that changes what comes next. */
const changed = (): void => { if (queue.current) prefetch(); persistSoon() }

// ── controls ────────────────────────────────────────────────────────────────

/**
 * Play a list from one of its tracks — a click in the library or a playlist.
 *
 * Clicking the song that is already loaded, from the same list, is a toggle
 * rather than a restart: that row is the pause button for what it plays.
 */
export const playFrom = (tracks: LibTrack[], index: number, context: Q.QueueContext): Promise<void> => {
  const same = queue.context?.key === context.key
    && !queue.fromManual
    && queue.pos >= 0
    && queue.order[queue.pos] === index
    && !!el?.src
  if (same) return toggle()
  return act(Q.start(queue, tracks, context, index, rng))
}

export const toggle = async (): Promise<void> => {
  if (!queue.current) return
  // Restored from a previous session and not loaded yet.
  if (!el?.src) { await act({ state: queue, track: queue.current, action: 'play' }); return }
  if (player.paused) await safePlay()
  else el.pause()
}

export const resume = async (): Promise<void> => { if (player.paused) await toggle() }
export const pause = (): void => { el?.pause() }

export const next = (): Promise<void> => act(Q.next(queue, 'skip', rng))
export const previous = (): Promise<void> => act(Q.previous(queue, el?.currentTime ?? player.at))
export const jumpTo = (target: Q.QueueTarget): Promise<void> => act(Q.jump(queue, target))

export const seek = (sec: number): void => {
  if (!Number.isFinite(sec)) return
  player.at = sec
  if (el?.src) el.currentTime = sec
  else pendingSeek = sec
}

export const setVolume = (v: number): void => {
  player.volume = Math.min(1, Math.max(0, v))
  player.muted = player.volume === 0
  if (el) el.volume = effectiveVolume()
  persistSoon()
}

export const toggleMute = (): void => {
  player.muted = !player.muted
  if (el) el.volume = effectiveVolume()
  persistSoon()
}

export const toggleShuffle = (): void => { apply(Q.setShuffle(queue, !queue.shuffle, rng)); changed() }
export const setShuffleOn = (): void => { apply(Q.setShuffle(queue, true, rng)); changed() }
export const cycleRepeat = (): void => { apply(Q.cycleRepeat(queue)); changed() }

export const playNext = (t: LibTrack): void => { apply(Q.enqueue(queue, t, 'next')); changed() }
export const addToQueue = (t: LibTrack): void => { apply(Q.enqueue(queue, t, 'last')); changed() }
export const removeFromQueue = (index: number): void => { apply(Q.unqueue(queue, index)); changed() }
export const clearQueue = (): void => { apply(Q.clearManual(queue)); changed() }

/** Silence and unload, without touching the queue. */
const unload = (): void => {
  if (el) { el.pause(); el.removeAttribute('src'); el.load() }
  elUrl = null
  pendingSeek = null
  player.at = 0
  player.duration = 0
  player.paused = true
  releaseFocus('preview')
  clearMedia()
}

/**
 * The mini player's close button: stop, and put the strip away.
 *
 * It used to remove the song from the queue entirely, so dismissing the
 * strip deleted a track from the list you were playing. Stopping is not
 * deleting; the list is left exactly as it was.
 */
export const stop = (): void => {
  unload()
  apply({ ...queue, current: null, fromManual: false })
  persistSoon()
}

/** A track was deleted from the library. Every copy leaves the queue. */
export const forget = (trackId: string): void => {
  const wasPlaying = queue.current?.id === trackId
  apply(Q.drop(queue, trackId))
  if (wasPlaying) unload()
  const url = cache.get(trackId)
  if (url && url !== elUrl) { URL.revokeObjectURL(url); cache.delete(trackId) }
  changed()
}

export const queueView = computed(() => Q.upNext(queue))
export const hasPlayer = computed(() => queue.current !== null)

// ── the OS and browser media controls ───────────────────────────────────────

const mediaMeta = (t: LibTrack): void => {
  if (!('mediaSession' in navigator)) return
  bindHandlers()
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || 'Unknown artist',
      album: t.album || 'Skycord',
      artwork: t.cover ? [{ src: t.cover, sizes: '320x320', type: 'image/webp' }] : [],
    })
  } catch { /* a browser without MediaMetadata still plays */ }
}

const mediaState = (): void => {
  if (!('mediaSession' in navigator)) return
  try { navigator.mediaSession.playbackState = player.paused ? 'paused' : 'playing' } catch { /* ignore */ }
}

const clearMedia = (): void => {
  if (!('mediaSession' in navigator)) return
  try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none' } catch { /* ignore */ }
}

let handlersBound = false
const bindHandlers = (): void => {
  if (handlersBound || !('mediaSession' in navigator)) return
  handlersBound = true
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler): void => {
    try { navigator.mediaSession.setActionHandler(action, fn) } catch { /* unsupported */ }
  }
  set('play', () => { void resume() })
  set('pause', () => pause())
  set('nexttrack', () => { void next() })
  set('previoustrack', () => { void previous() })
  set('seekto', d => { if (typeof d.seekTime === 'number') seek(d.seekTime) })
}

let lastSave = 0
function onTime(): void {
  if (!el) return
  player.at = el.currentTime
  try {
    navigator.mediaSession?.setPositionState?.({
      duration: Number.isFinite(el.duration) ? el.duration : player.duration,
      position: el.currentTime,
      playbackRate: 1,
    })
  } catch { /* duration not known yet */ }
  if (Date.now() - lastSave > 5000) persistNow()
}

// ── remembering ─────────────────────────────────────────────────────────────

/**
 * The queue, the position and the preferences, per account.
 *
 * A convenience, not state anything else relies on: it lives in this
 * browser, it can be empty or unreadable at any time, and every read and
 * write is guarded so a full or blocked storage just means starting fresh.
 * Keyed by user, so signing in as someone else never resumes the last
 * person's list.
 */
const KEY = 'sykord_music_player'
let storageKey: string | null = null

interface Saved {
  v: 1
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: Q.RepeatMode
  resume: null | {
    context: Q.QueueContext | null
    tracks: LibTrack[]
    order: number[]
    pos: number
    manual: LibTrack[]
    current: LibTrack | null
    fromManual: boolean
    at: number
  }
}

/**
 * Covers are data URIs of up to a few hundred KB. A long list of them would
 * exceed the storage quota, so they are saved without and refilled from the
 * library when it loads. The playing song keeps its cover if it is small,
 * so the mini player is not blank after a reload.
 */
const slim = (t: LibTrack): LibTrack => ({ ...t, cover: null })

const persistNow = (): void => {
  lastSave = Date.now()
  if (!storageKey) return
  const c = queue.current
  const saved: Saved = {
    v: 1,
    volume: player.volume, muted: player.muted, shuffle: queue.shuffle, repeat: queue.repeat,
    resume: (c || queue.tracks.length) ? {
      context: queue.context,
      tracks: queue.tracks.map(slim),
      order: [...queue.order],
      pos: queue.pos,
      manual: queue.manual.map(slim),
      current: c ? (c.cover && c.cover.length < 120_000 ? { ...c } : slim(c)) : null,
      fromManual: queue.fromManual,
      at: player.at,
    } : null,
  }
  try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch { /* full, or private mode */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const persistSoon = (): void => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 300)
}

/** A stored queue is only trusted if it is internally consistent. */
const coherent = (r: NonNullable<Saved['resume']>): boolean =>
  Array.isArray(r.tracks) && Array.isArray(r.order) && Array.isArray(r.manual)
  && r.order.length === r.tracks.length
  && r.order.every(i => Number.isInteger(i) && i >= 0 && i < r.tracks.length)
  && Number.isInteger(r.pos) && r.pos >= -1 && r.pos < r.order.length

const restore = (key: string): void => {
  storageKey = key
  let s: Saved | null = null
  try { s = JSON.parse(localStorage.getItem(key) || 'null') as Saved | null } catch { s = null }
  if (!s || s.v !== 1) return

  if (typeof s.volume === 'number') player.volume = Math.min(1, Math.max(0, s.volume))
  player.muted = !!s.muted
  if (el) el.volume = effectiveVolume()

  const r = s.resume && coherent(s.resume) ? s.resume : null
  apply({
    ...Q.emptyQueue<LibTrack>(),
    shuffle: !!s.shuffle,
    repeat: s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off',
    ...(r ? {
      context: r.context, tracks: r.tracks, order: r.order, pos: r.pos,
      manual: r.manual, current: r.current, fromManual: !!r.fromManual,
    } : {}),
  })
  if (r?.current) {
    // Paused, at the position you left it. Nothing downloads until you
    // press play — opening the app should not start pulling audio.
    player.at = Number(r.at) || 0
    player.duration = r.current.durationSec
    player.paused = true
    pendingSeek = player.at || null
    mediaMeta(r.current)
  }
}

const { user } = useAuth()
watch(() => user.value?.id ?? null, (id, prev) => {
  if (prev && prev !== id) {
    // Save the outgoing account's place under its own key first, then go
    // quiet: the next person must not hear the last one's music.
    persistNow()
    unload()
    apply(Q.emptyQueue<LibTrack>())
  }
  storageKey = null
  if (id) restore(`${KEY}:${id}`)
}, { immediate: true })

/** Put covers back on songs that were saved without them. */
watch(() => library.tracks, list => {
  if (!list.length) return
  const byId = new Map(list.map(t => [t.id, t]))
  const fill = (t: LibTrack): LibTrack => {
    const found = byId.get(t.id)
    return !t.cover && found?.cover ? { ...t, cover: found.cover } : t
  }
  const needs = (t: LibTrack | null): boolean => !!t && !t.cover && !!byId.get(t.id)?.cover
  if (!needs(queue.current) && !queue.tracks.some(needs) && !queue.manual.some(needs)) return
  const hadNoCover = needs(queue.current)
  apply({
    ...queue,
    tracks: queue.tracks.map(fill),
    manual: queue.manual.map(fill),
    current: queue.current ? fill(queue.current) : null,
  })
  if (hadNoCover && queue.current) mediaMeta(queue.current)
})
