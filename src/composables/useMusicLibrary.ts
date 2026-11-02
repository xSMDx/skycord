/**
 * A member's own tracks and playlists.
 *
 * Separate from useMusic.ts on purpose. That one is about a call: which
 * music channels are open in this voice room and who is listening to each,
 * all of it live over the socket and gone when the call ends. This is about
 * what you own, which is durable and reaches the server over HTTP. They
 * meet in one place — playing a track from here into a channel there — and
 * keeping them apart keeps that seam honest.
 */
import { reactive, computed, watch } from 'vue'
import { useApi, type WireTrack, type WirePlaylist, type MusicLibraryCaps } from './useApi'
import { useAuth, silentRefresh } from './useAuth'
import { uploadFailure, tooBigToUpload } from './uploadFailure'
import {
  createUploadQueue, looksLikeAudio, NOT_REACHED,
  type Attempt, type RateHeaders, type UploadItem, type UploadBatch,
} from './uploadScheduler'

// The wire shapes are defined once, in useApi, beside every other one.
export type LibTrack = WireTrack
export type LibPlaylist = WirePlaylist
export type LibraryCaps = MusicLibraryCaps

export const library = reactive({
  tracks: [] as LibTrack[],
  playlists: [] as LibPlaylist[],
  /** The open playlist, resolved with its tracks. Null means "all tracks". */
  open: null as LibPlaylist | null,
  usage: { tracks: 0, bytes: 0 },
  caps: null as LibraryCaps | null,
  loading: false,
  /** Shown in the modal, cleared by the next successful action. */
  error: '',
  /** A link import is on its way. Files have their own rows: see `uploads`. */
  importing: false,
})

const api = () => useApi()

/** The API answers with { message }, as it does everywhere else. */
const reasonOf = (err: unknown): string =>
  (err as { message?: string })?.message ?? 'Something went wrong.'

const say = (err: unknown): void => { library.error = reasonOf(err) }

/**
 * A call made as one of many. The bulk acts in the library put each failure's
 * reason on its own row, so the banner over the list would only say the last
 * one again, out of context.
 */
export interface Quiet { quiet?: boolean }

export const clearLibraryError = (): void => { library.error = '' }

export const loadLibrary = async (q = ''): Promise<void> => {
  library.loading = true
  try {
    const r = await api().listMusicTracks(q)
    library.tracks = r.tracks
    library.usage = r.usage
    library.caps = r.caps
    library.error = ''
  } catch (e) { say(e) } finally { library.loading = false }
}

export const loadPlaylists = async (): Promise<void> => {
  try {
    const r = await api().listPlaylistsApi()
    library.playlists = r.playlists
  } catch (e) { say(e) }
}

export const openPlaylist = async (id: string | null): Promise<void> => {
  if (!id) { library.open = null; return }
  try {
    const r = await api().getPlaylistApi(id)
    library.open = r.playlist
    library.error = ''
  } catch (e) { say(e) }
}

/** A new track at the top of the library — once, even if a reload of the
 *  list raced the answer and already brought it. */
const addToLibrary = (t: LibTrack): void => {
  if (library.tracks.some(x => x.id === t.id)) return
  library.tracks.unshift(t)
  library.usage.tracks++
  library.usage.bytes += t.bytes
}

export type UploadAttempt = Attempt<LibTrack>

/** The two headers a 429 says how long to wait in. Same origin for every
 *  client (the web app, the desktop shell and the Android app all load the
 *  page from the instance itself and call it by relative path), so CORS has
 *  nothing to hide here. */
const rateHeaders = (xhr: XMLHttpRequest): RateHeaders => ({
  'retry-after': xhr.getResponseHeader('Retry-After') ?? undefined,
  'ratelimit-reset': xhr.getResponseHeader('RateLimit-Reset') ?? undefined,
})

/**
 * How long an upload may go without a byte moving before it is given up on.
 * A connection that dies quietly — a phone between towers, a laptop lid shut
 * mid-upload — sends no error, and XHR waits for ever. A total timeout would
 * cut off a large file on a slow line that is working fine, so this times the
 * silence instead: every progress event starts the minute again.
 */
export const UPLOAD_STALL_MS = 60_000

/**
 * Upload one file. XHR rather than fetch, for one reason: progress.
 *
 * fetch cannot report how much of a request body has gone out, and a
 * 40MB upload with no progress bar is indistinguishable from a hang. The
 * body is the file itself — no multipart wrapper, because there is one
 * file and no fields, and the server pipes it straight through.
 *
 * It never throws and never touches the library: it says what happened —
 * the track, or the status, the rate headers and a sentence — and the upload
 * queue decides. A 429 is waited out, anything else fails that file alone,
 * and status 0 is a request that never got an answer — a dead connection, or
 * one stalled for UPLOAD_STALL_MS, which holds the queue for a Retry.
 *
 * The stall is timed only while bytes are going out. Once all of them are
 * there the server is scanning and converting, which it bounds itself, and
 * giving up then would send the same song twice: the first one still lands.
 */
export const uploadTrack = (
  file: File,
  token: string,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadAttempt> =>
  new Promise((answer) => {
    const stopped: UploadAttempt = { ok: false, status: 0, headers: {}, message: 'The upload was stopped.' }
    if (opts.signal?.aborted) { answer(stopped); return }
    const xhr = new XMLHttpRequest()

    let stall: ReturnType<typeof setTimeout> | null = null
    const calm = (): void => { if (stall) { clearTimeout(stall); stall = null } }
    // Every way this ends goes through here, so no watchdog outlives it.
    const resolve = (a: UploadAttempt): void => { calm(); answer(a) }
    const watch = (): void => {
      calm()
      stall = setTimeout(() => {
        stall = null
        // Answered first: the abort that follows would answer "stopped".
        resolve({ ok: false, status: 0, headers: {}, message: NOT_REACHED })
        xhr.abort()
      }, UPLOAD_STALL_MS)
    }

    xhr.open('POST', '/music/tracks/upload')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.withCredentials = true

    xhr.upload.onprogress = (e) => {
      watch()
      if (e.lengthComputable && e.total) opts.onProgress?.(e.loaded / e.total)
    }
    // Every byte is there. What follows is the server scanning and converting.
    xhr.upload.onload = () => { calm(); opts.onProgress?.(1) }

    xhr.onload = () => {
      let body: { track?: LibTrack } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* read from the status below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.track) {
        resolve({ ok: true, value: body.track })
        return
      }
      resolve({
        ok: false, status: xhr.status, headers: rateHeaders(xhr),
        message: uploadFailure(xhr.status, xhr.responseText),
      })
    }
    xhr.onerror = () => resolve({ ok: false, status: 0, headers: {}, message: NOT_REACHED })
    xhr.onabort = () => resolve(stopped)
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })

    xhr.send(file)
    watch()
  })

// ── the upload queue ────────────────────────────────────────────────────────
/*
 * Here rather than in the modal, so closing the modal does not stop a batch
 * and reopening it shows where the batch has got to.
 */

/** One row per file: waiting, going up, checking and converting, done, failed,
 *  or waiting out the server's limit. */
export const uploads = reactive<UploadItem[]>([])
/** Files done of files in this batch, for "3 of 8 uploaded"; and whether a
 *  lost connection is holding it for a Retry. */
export const uploadBatch = reactive<UploadBatch>({ total: 0, done: 0, held: false })

const { user, accessToken } = useAuth()

/**
 * One try with the session as it is now. A batch can outlast an access token
 * — 25 songs and a wait for the limit take minutes — so each file reads the
 * token as it starts, and a 401 gets one refresh and one more try. A refresh
 * that fails signs the session out, which clears the queue below.
 */
const sendWithSession = async (
  file: File, progress: (fraction: number) => void, signal: AbortSignal,
): Promise<UploadAttempt> => {
  const token = accessToken.value
  if (!token) return { ok: false, status: 401, headers: {}, message: 'Sign in again to upload.' }
  const first = await uploadTrack(file, token, { onProgress: progress, signal })
  if (first.ok || first.status !== 401 || signal.aborted) return first
  if (!(await silentRefresh()) || !accessToken.value || signal.aborted) return first
  return uploadTrack(file, accessToken.value, { onProgress: progress, signal })
}

const queue = createUploadQueue<LibTrack>({
  items: uploads,
  batch: uploadBatch,
  send: sendWithSession,
  // A finished file shows up in the library at once, as a single upload did.
  uploaded: addToLibrary,
  refuse: f => tooBigToUpload(f.size, library.caps?.maxUploadBytes),
})

/** Who the queue is uploading for: nobody without a token. */
const session = (): string | null => (accessToken.value ? user.value?.id ?? null : null)

/*
 * Signing out, or in as someone else, ends the batch: the next file would go
 * up with a token that is gone or is not theirs, into a library that is not
 * theirs. Sync, so no file can start between the change and the clear.
 */
watch(session, (now, before) => { if (now !== before) queue.clear() }, { flush: 'sync' })

/** Carry on after a lost connection, starting with the file that was held. */
export const retryUploads = (): void => { queue.resume() }

/*
 * And carry on by itself when the browser says the connection is back. Only
 * listened for while held, so an online event at any other time is nobody's
 * business here, and a sign-out (which clears the hold) stops the listening.
 * Not a promise that the server can be reached — a captive portal is
 * "online" — but a wrong guess only holds the batch again.
 */
let stopListening: (() => void) | null = null
watch(() => uploadBatch.held, (held) => {
  stopListening?.()
  stopListening = null
  if (!held || typeof window === 'undefined') return
  const target = window
  target.addEventListener('online', retryUploads)
  stopListening = () => target.removeEventListener('online', retryUploads)
}, { flush: 'sync' })

/**
 * Add files to the queue, in the order given. What is not audio is left out
 * with a word about it: a dragged folder of covers should not spend the
 * upload limit on being refused one by one.
 */
export const enqueueUploads = (files: File[]): void => {
  const out = files.filter(f => !looksLikeAudio(f))
  library.error = !out.length ? ''
    : out.length === 1 ? `${out[0].name} isn’t an audio file, so it was left out.`
    : `${out.length} files aren’t audio, so they were left out.`
  queue.enqueue(files.filter(looksLikeAudio))
}

/** Skip a waiting file, stop one going up, or dismiss a failed one. A file the
 *  server is already checking and converting stays: it cannot be called back. */
export const dropUpload = (id: string): void => { queue.drop(id) }

/**
 * Import from a link. Not part of the upload queue, on purpose: it is one
 * request the person is watching, with the link still in the box to correct,
 * and it must never sit behind twenty files. It shares the server's limit, so
 * at the limit it says the limiter's words and keeps the link for another go.
 */
export const importTrack = async (url: string): Promise<LibTrack | null> => {
  const who = session()
  library.importing = true
  library.error = ''
  try {
    const r = await api().importMusicTrack(url)
    // Signed out meanwhile: the song is theirs, not the next person's.
    if (session() === who) addToLibrary(r.track)
    return r.track
  } catch (e) { say(e); return null } finally { library.importing = false }
}

/** Null once it is gone; otherwise why it is not. */
export const deleteTrack = async (id: string, opts: Quiet = {}): Promise<string | null> => {
  try {
    await api().deleteMusicTrack(id)
    const at = library.tracks.findIndex(t => t.id === id)
    if (at >= 0) {
      library.usage.tracks--
      library.usage.bytes -= library.tracks[at].bytes
      library.tracks.splice(at, 1)
    }
    // The open playlist may have been showing it. Drop it there too rather
    // than refetching — the server does the same thing on its next read.
    if (library.open?.tracks) {
      library.open.tracks = library.open.tracks.filter(t => t.id !== id)
      library.open.count = library.open.tracks.length
    }
    return null
  } catch (e) {
    if (!opts.quiet) say(e)
    return reasonOf(e)
  }
}

export const createPlaylist = async (name: string): Promise<LibPlaylist | null> => {
  try {
    const r = await api().createPlaylistApi(name)
    library.playlists.unshift(r.playlist)
    return r.playlist
  } catch (e) { say(e); return null }
}

export const deletePlaylist = async (id: string): Promise<void> => {
  try {
    await api().deletePlaylistApi(id)
    library.playlists = library.playlists.filter(p => p.id !== id)
    if (library.open?.id === id) library.open = null
  } catch (e) { say(e) }
}

export const addToPlaylist = async (playlistId: string, trackId: string): Promise<void> => {
  try {
    const r = await api().addToPlaylistApi(playlistId, trackId)
    const at = library.playlists.findIndex(p => p.id === playlistId)
    if (at >= 0) library.playlists[at] = { ...library.playlists[at], ...r.playlist }
    if (library.open?.id === playlistId) await openPlaylist(playlistId)
  } catch (e) { say(e) }
}

/** By place, not by song: a playlist can hold one song twice. Null once it is out. */
export const removeFromPlaylist = async (playlistId: string, index: number, opts: Quiet = {}): Promise<string | null> => {
  try {
    await api().removeFromPlaylistApi(playlistId, index)
  } catch (e) {
    if (!opts.quiet) say(e)
    return reasonOf(e)
  }
  if (library.open?.id === playlistId) await openPlaylist(playlistId)
  return null
}

/** What the centre pane is showing: a playlist's tracks, or the whole library. */
export const shownTracks = computed<LibTrack[]>(() =>
  library.open ? (library.open.tracks ?? []) : library.tracks)

export const trackAudioUrl = (id: string): string => `/music/tracks/${id}/audio`

// ── formatting ──────────────────────────────────────────────────────────────

/** m:ss, and h:mm:ss only once there are hours — a leading "0:" is noise. */
export const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "48 minutes", "1 hr 12 min" — a total, read aloud rather than counted. */
export const totalTime = (tracks: LibTrack[]): string => {
  const s = tracks.reduce((n, t) => n + t.durationSec, 0)
  if (s < 60) return `${s} sec`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} hr ${m % 60} min`
}

export const megabytes = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
