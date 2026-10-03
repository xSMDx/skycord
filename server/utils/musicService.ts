/**
 * The API's side of the line to the music service.
 *
 * Deliberately thin, and deliberately forgiving. The service is a separate
 * container that a host may simply not run — `MUSIC_SERVICE_URL` unset is
 * the normal case, not an error — so every call here is a no-op when music
 * is not configured, and a logged failure when it is configured and
 * unreachable.
 *
 * Nothing here throws into a socket handler. A member whose music did not
 * start sees a channel playing nothing, which the UI already has a shape
 * for; a member whose socket handler threw sees the whole app misbehave.
 */
import { config } from '../config/env'

export interface MusicServiceConfig {
  url: string
  secret: string
  /** Milliseconds. The service answers immediately and plays in the background. */
  timeoutMs?: number
}

export const musicConfigured = (): boolean =>
  Boolean(config.music?.url && config.music?.secret)

const post = async (path: string, body: unknown): Promise<boolean> => {
  const url = config.music?.url
  const secret = config.music?.secret
  if (!url || !secret) return false
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-music-secret': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.music?.timeoutMs ?? 5_000),
    })
    if (!res.ok) {
      console.warn(`[music] ${path} answered ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    // Unreachable, slow, or not running. Said once, plainly, without a stack
    // — a host who has not started the container does not need a trace.
    console.warn(`[music] ${path} failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** Start (or replace) what is playing on a channel. */
export const musicPlay = (room: string, channelId: string, url: string): Promise<boolean> =>
  post('/play', { room, channelId, url })

/**
 * Play a track from the library.
 *
 * No URL crosses this call. The service composes the address from its own
 * `API_INTERNAL_URL` and reads it back with the shared secret, which is why
 * a library track needs none of the SSRF machinery a pasted link does.
 */
export const musicPlayTrack = (room: string, channelId: string, trackId: string): Promise<boolean> =>
  post('/play-track', { room, channelId, trackId })

/** Stop a channel and unpublish its track. */
export const musicClose = (room: string, channelId: string): Promise<boolean> =>
  post('/close', { room, channelId })

// ── Ingest ──────────────────────────────────────────────────────────────────

/**
 * The card the service returns for an accepted file. The audio itself stays
 * in the service until collected — see music/src/ingestHold.ts for why the
 * two are separate requests.
 */
export interface IngestCard {
  title: string
  artist: string
  album: string
  durationSec: number
  bytes: number
  mimeType: string
  coverWebp?: string
  scan: 'clean' | 'skipped'
}

export type IngestAnswer =
  | { ok: true; id: string; track: IngestCard }
  | { ok: false; reason: string }

/**
 * Ingest is minutes of work on a long track, not the seconds the playback
 * calls take: a transcode plus, when one is configured, a whole-file virus
 * scan. The default timeout here would abandon a perfectly good upload.
 */
const INGEST_TIMEOUT_MS = 10 * 60_000

const ingestFailed = (reason: string): IngestAnswer => ({ ok: false, reason })

const ingestCall = async (path: string, init: RequestInit): Promise<IngestAnswer> => {
  const url = config.music?.url
  const secret = config.music?.secret
  if (!url || !secret) return ingestFailed('Music is not available on this server.')
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), 'x-music-secret': secret },
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => null) as IngestAnswer | null
    // A refusal carries a reason written for the member — "that is a Windows
    // program, not audio" — and passing it through is the whole value of it.
    if (!res.ok) return ingestFailed(body && 'reason' in body ? body.reason : 'That file could not be added.')
    if (!body || !('ok' in body) || !body.ok) return ingestFailed('That file could not be added.')
    return body
  } catch (err) {
    console.warn(`[music] ${path} failed: ${err instanceof Error ? err.message : String(err)}`)
    return ingestFailed('The music service is not responding.')
  }
}

/** Hand the raw upload stream straight through. Never buffered in the API. */
export const musicIngestUpload = (body: NodeJS.ReadableStream, contentType: string): Promise<IngestAnswer> =>
  ingestCall('/ingest/upload', {
    method: 'POST',
    headers: { 'content-type': contentType || 'application/octet-stream' },
    // Cast because the server's lib has no DOM types; undici accepts a Node
    // stream here and streaming is the point — the API never holds the file.
    body: body as unknown as RequestInit['body'],
    // Required by undici whenever the body is a stream: without it the
    // request is rejected before it leaves the process.
    duplex: 'half',
  } as RequestInit)

export const musicIngestLink = (link: string): Promise<IngestAnswer> =>
  ingestCall('/ingest/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: link }),
  })

/** Collect the normalised audio. The service deletes its copy as it sends. */
export const musicCollect = async (id: string): Promise<NodeJS.ReadableStream | null> => {
  const url = config.music?.url
  const secret = config.music?.secret
  if (!url || !secret) return null
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/ingest/${encodeURIComponent(id)}/audio`, {
      headers: { 'x-music-secret': secret },
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) return null
    return res.body as unknown as NodeJS.ReadableStream
  } catch (err) {
    console.warn(`[music] collect failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Give up on a held upload, so the service is not left holding the file. */
export const musicDropIngest = async (id: string): Promise<void> => {
  const url = config.music?.url
  const secret = config.music?.secret
  if (!url || !secret) return
  try {
    await fetch(`${url.replace(/\/$/, '')}/ingest/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-music-secret': secret },
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* the hold expires on its own; this is only politeness */ }
}
