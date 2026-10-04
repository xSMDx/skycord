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
import { reactive, computed } from 'vue'
import { useApi, type WireTrack, type WirePlaylist, type MusicLibraryCaps } from './useApi'
import { uploadFailure, tooBigToUpload } from './uploadFailure'

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
  /** 0–100 while a file is going up, null when nothing is. */
  uploading: null as number | null,
})

const api = () => useApi()

const say = (err: unknown): void => {
  // The API answers with { message }, as it does everywhere else.
  const msg = (err as { message?: string })?.message ?? 'Something went wrong.'
  library.error = msg
}

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

/**
 * Upload with XHR rather than fetch, for one reason: progress.
 *
 * fetch cannot report how much of a request body has gone out, and a
 * 40MB upload with no progress bar is indistinguishable from a hang. The
 * body is the file itself — no multipart wrapper, because there is one
 * file and no fields, and the server pipes it straight through.
 */
export const uploadTrack = (file: File, token: string): Promise<LibTrack | null> =>
  new Promise((resolve) => {
    const tooBig = tooBigToUpload(file.size, library.caps?.maxUploadBytes)
    if (tooBig) { library.error = tooBig; resolve(null); return }
    library.uploading = 0
    library.error = ''
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/music/tracks/upload')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.withCredentials = true

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      // Capped below 100: the bytes being sent is not the work being done.
      // Transcoding and scanning happen after the last byte arrives, and a
      // bar that sits at 100% for a minute reads as broken.
      library.uploading = Math.min(95, Math.round((e.loaded / e.total) * 95))
    }

    xhr.onload = () => {
      library.uploading = null
      let body: { track?: LibTrack; message?: string } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.track) {
        library.tracks.unshift(body.track)
        library.usage.tracks++
        library.usage.bytes += body.track.bytes
        resolve(body.track)
        return
      }
      library.error = uploadFailure(xhr.status, xhr.responseText)
      resolve(null)
    }
    xhr.onerror = () => {
      library.uploading = null
      library.error = 'That upload did not reach the server.'
      resolve(null)
    }

    xhr.send(file)
  })

export const importTrack = async (url: string): Promise<LibTrack | null> => {
  library.uploading = 0
  library.error = ''
  try {
    const r = await api().importMusicTrack(url)
    library.tracks.unshift(r.track)
    library.usage.tracks++
    library.usage.bytes += r.track.bytes
    return r.track
  } catch (e) { say(e); return null } finally { library.uploading = null }
}

export const deleteTrack = async (id: string): Promise<void> => {
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
  } catch (e) { say(e) }
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

export const removeFromPlaylist = async (playlistId: string, index: number): Promise<void> => {
  try {
    await api().removeFromPlaylistApi(playlistId, index)
    if (library.open?.id === playlistId) await openPlaylist(playlistId)
  } catch (e) { say(e) }
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
