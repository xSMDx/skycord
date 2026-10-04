/**
 * The local music player: one audio element, owned by nobody's component.
 *
 * It used to live inside MusicModal, which meant closing the modal unmounted
 * the element and the music stopped — and reopening started the track over,
 * because the position died with it. Three separate complaints with one
 * cause. A player is not a property of a dialog; it is a property of the
 * session, so it lives here and the modal is one of several views onto it.
 *
 * Hoisting it is also what makes a mini player and the OS media controls
 * possible at all: both need something to attach to that is still there when
 * the modal is not.
 *
 * ## Why the bytes are fetched rather than given to `src`
 *
 * The stream route is behind requireAuth, which reads a Bearer header, and
 * an audio element cannot send one — it sends cookies, and the only cookie
 * here is the refresh token, which has no business authorising a resource
 * read. So `src` pointing at the route 401s on every track.
 *
 * The cost is that a track downloads before it starts instead of streaming.
 * A short-lived signed URL would restore progressive playback and would also
 * put a credential in a URL, which is not worth it until a long track makes
 * the wait annoying.
 */
import { reactive, computed } from 'vue'
import { useAuth } from './useAuth'
import { trackAudioUrl, type LibTrack } from './useMusicLibrary'
import { onYield, takeAudio, release } from './audioFocus'

export type RepeatMode = 'off' | 'all' | 'one'

export const player = reactive({
  /** What is loaded. Null before anything has been played this session. */
  current: null as LibTrack | null,
  /** The list the current track came from, so next/previous mean something. */
  queue: [] as LibTrack[],
  paused: true,
  /** Seconds. Driven by the element's own timeupdate, never guessed. */
  at: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  /** The id being fetched, so a row can show it is working. */
  loadingId: null as string | null,
  shuffle: false,
  repeat: 'off' as RepeatMode,
  error: '' as string,
})

let el: HTMLAudioElement | null = null
let objectUrl: string | null = null

// Tuning into a music channel stops the preview: you are listening to the
// room now, and hearing your own copy underneath it is the bug this fixes.
onYield('preview', () => { el?.pause() })

/**
 * Created on first use, not at import.
 *
 * This module is imported by the sidebar, which renders before anything has
 * been played — building an audio element then would leave one attached for
 * every session that never touches music.
 */
const element = (): HTMLAudioElement => {
  if (el) return el
  el = new Audio()
  el.preload = 'auto'
  el.volume = player.volume

  el.addEventListener('play',  () => { player.paused = false; mediaState() })
  el.addEventListener('pause', () => { player.paused = true;  mediaState() })
  el.addEventListener('timeupdate', () => {
    player.at = el!.currentTime
    // Position in the OS controls, so a scrubber there tracks the real one.
    try {
      navigator.mediaSession?.setPositionState?.({
        duration: el!.duration || 0,
        position: el!.currentTime,
        playbackRate: 1,
      })
    } catch { /* unsupported, or duration is NaN mid-load */ }
  })
  el.addEventListener('loadedmetadata', () => { player.duration = el!.duration || 0 })
  el.addEventListener('ended', onEnded)
  return el
}

// Named for what it frees. `release` now belongs to audioFocus, and two
// different releases in one file is how the wrong one gets called.
const releaseUrl = (): void => {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
}

// ── the OS and browser media controls ───────────────────────────────────────

/**
 * Tell the browser what is playing.
 *
 * Without this the Media Control Center shows the origin and nothing else —
 * "localhost:5500", no title, no art, and its buttons do nothing. The
 * handlers are registered once; the metadata is replaced per track.
 */
const mediaMeta = (t: LibTrack): void => {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || 'Unknown artist',
      album: t.album || 'Skycord',
      artwork: t.cover ? [{ src: t.cover, sizes: '320x320', type: 'image/webp' }] : [],
    })
  } catch { /* a browser without MediaMetadata still plays fine */ }
}

const mediaState = (): void => {
  if (!('mediaSession' in navigator)) return
  try { navigator.mediaSession.playbackState = player.paused ? 'paused' : 'playing' } catch { /* ignore */ }
}

let handlersBound = false
const bindHandlers = (): void => {
  if (handlersBound || !('mediaSession' in navigator)) return
  handlersBound = true
  const set = (action: MediaSessionAction, fn: () => void) => {
    try { navigator.mediaSession.setActionHandler(action, fn) } catch { /* unsupported action */ }
  }
  set('play',  () => { void resume() })
  set('pause', () => pause())
  set('nexttrack',     () => step(1))
  set('previoustrack', () => step(-1))
  set('seekto', () => { /* replaced below, needs the event */ })
  try {
    navigator.mediaSession.setActionHandler('seekto', (d: MediaSessionActionDetails) => {
      if (typeof d.seekTime === 'number') seek(d.seekTime)
    })
  } catch { /* unsupported */ }
}

// ── controls ────────────────────────────────────────────────────────────────

export const play = async (t: LibTrack, from?: LibTrack[]): Promise<void> => {
  const a = element()
  bindHandlers()
  if (from) player.queue = [...from]

  // Already loaded: this is a toggle, not a new track.
  if (player.current?.id === t.id && objectUrl) {
    if (player.paused) await resume()
    else pause()
    return
  }

  // Claimed before the fetch, so a slow download cannot start playing
  // underneath a channel you tuned into while waiting.
  takeAudio('preview')
  player.current = t
  player.loadingId = t.id
  player.error = ''
  try {
    const { accessToken } = useAuth()
    const res = await fetch(trackAudioUrl(t.id), {
      headers: accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {},
      credentials: 'include',
    })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    // Somebody picked a different track while this one was downloading.
    if (player.current?.id !== t.id) return

    releaseUrl()
    objectUrl = URL.createObjectURL(blob)
    a.src = objectUrl
    a.volume = player.muted ? 0 : player.volume
    mediaMeta(t)
    await a.play()
  } catch {
    player.error = 'That track could not be played.'
    player.paused = true
  } finally {
    if (player.loadingId === t.id) player.loadingId = null
  }
}

export const resume = async (): Promise<void> => {
  if (!el || !objectUrl) return
  takeAudio('preview')
  try { await el.play() } catch { player.paused = true }
}

export const pause = (): void => { el?.pause() }

export const toggle = async (): Promise<void> => {
  if (!player.current) return
  if (player.paused) await resume()
  else pause()
}

export const seek = (sec: number): void => {
  if (el && Number.isFinite(sec)) el.currentTime = sec
}

export const setVolume = (v: number): void => {
  player.volume = v
  player.muted = v === 0
  if (el) el.volume = v
}

export const toggleMute = (): void => {
  player.muted = !player.muted
  if (el) el.volume = player.muted ? 0 : player.volume
}

export const step = (by: 1 | -1): void => {
  const list = player.queue
  if (!list.length || !player.current) return

  if (player.shuffle && list.length > 1) {
    let n = Math.floor(Math.random() * list.length)
    // Never the one already playing: a shuffle that repeats the current
    // track reads as a button that did nothing.
    while (list[n].id === player.current.id) n = (n + 1) % list.length
    void play(list[n])
    return
  }

  const i = list.findIndex(t => t.id === player.current!.id)
  // Wraps, because a list that stops dead at the end is one you have to
  // scroll back up to restart.
  void play(list[(i + by + list.length) % list.length])
}

function onEnded(): void {
  if (player.repeat === 'one') { seek(0); void resume(); return }
  const list = player.queue
  if (!list.length || !player.current) return
  const i = list.findIndex(t => t.id === player.current!.id)
  const last = i === list.length - 1
  // 'off' stops at the end rather than looping back to the top, which is
  // what the word means; step() wraps because pressing next is a request.
  if (last && player.repeat === 'off' && !player.shuffle) return
  step(1)
}

/** Drop a track that no longer exists, so the bar does not advertise it. */
export const forget = (trackId: string): void => {
  player.queue = player.queue.filter(t => t.id !== trackId)
  if (player.current?.id !== trackId) return
  pause()
  releaseUrl()
  release('preview')
  player.current = null
  player.at = 0
  player.duration = 0
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = null } catch { /* ignore */ }
  }
}

export const toggleShuffle = (): void => { player.shuffle = !player.shuffle }

/**
 * off -> all -> one -> off.
 *
 * Three states on one button, in the order they escalate: none, the list,
 * this track. Cycling is what every player does and what the icon change
 * has to carry, so the icon differs for 'one' rather than only the colour.
 */
export const cycleRepeat = (): void => {
  player.repeat = player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off'
}

/**
 * What plays after this, in the order it will actually happen.
 *
 * Not the raw queue: the queue is the list you started from, and what comes
 * next depends on where you are in it and whether repeat is on. Shuffle is
 * deliberately not predicted — it picks when it gets there, so claiming an
 * order here would be a lie the next press contradicts.
 */
export const upNext = computed<LibTrack[]>(() => {
  if (!player.current || !player.queue.length) return []
  if (player.shuffle) return []
  const i = player.queue.findIndex(t => t.id === player.current!.id)
  if (i < 0) return []
  const after = player.queue.slice(i + 1)
  if (player.repeat === 'all') return [...after, ...player.queue.slice(0, i)]
  return after
})

export const hasPlayer = computed(() => player.current !== null)
