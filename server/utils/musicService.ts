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

/** Stop a channel and unpublish its track. */
export const musicClose = (room: string, channelId: string): Promise<boolean> =>
  post('/close', { room, channelId })
