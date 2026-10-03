/**
 * The music service.
 *
 * Fetches audio a member linked, decodes it, and publishes it into a LiveKit
 * room as one track per music channel. It holds no database credentials and
 * no session state: the API owns what is playing and who is listening, and
 * this owns only the audio.
 */
import { MusicPublisher } from './publisher.js'
import { createMusicServer } from './server.js'

const req = (key: string): string => {
  const v = process.env[key]
  if (!v) { console.error(`[music] missing required env variable: ${key}`); process.exit(1) }
  return v
}
const num = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (!raw) return fallback
  const v = Number(raw)
  // Same reasoning as the API's caps: a typo must not become a limit of NaN,
  // which compares false against everything and therefore permits everything.
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

const log = (msg: string) => console.log(`[music] ${msg}`)

const publisher = new MusicPublisher({
  url: req('LIVEKIT_URL'),
  apiKey: req('LIVEKIT_API_KEY'),
  apiSecret: req('LIVEKIT_API_SECRET'),
  ffmpegPath: process.env.FFMPEG_PATH,
  log,
})

/**
 * Tell the API a track finished, so it can start the next one.
 *
 * Fire and forget. If the API is restarting, the channel keeps playing
 * nothing until somebody queues again — which is a visible, recoverable
 * state, and much better than this process retrying into a server that is
 * not there.
 */
const apiUrl = process.env.API_INTERNAL_URL ?? ''
const secret = req('MUSIC_INTERNAL_SECRET')
const onEnded = (room: string, channelId: string): void => {
  if (!apiUrl) return
  void fetch(`${apiUrl.replace(/\/$/, '')}/internal/music/ended`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-music-secret': secret },
    body: JSON.stringify({ room, channelId }),
    signal: AbortSignal.timeout(5_000),
  }).catch(e => log(`could not report the end of ${room}/${channelId}: ${String(e).slice(0, 120)}`))
}

const server = createMusicServer(publisher, {
  port: num('PORT', 3060),
  host: process.env.BIND_HOST ?? '0.0.0.0',
  secret,
  maxBytes: num('MUSIC_MAX_BYTES', 100 * 1024 * 1024),
  onEnded,
  log,
})

/**
 * On the way out, leave the rooms.
 *
 * A LiveKit participant that is never disconnected lingers until the server
 * times it out, and a lingering `svc:music` is a track members can still
 * try to subscribe to — the same ghost the voice work spent a day removing,
 * wearing a different hat.
 */
const stop = (signal: string) => {
  log(`${signal} — leaving every room`)
  server.close()
  void publisher.shutdown().finally(() => process.exit(0))
  // Do not wait forever for a disconnect that is not coming.
  setTimeout(() => process.exit(0), 5_000).unref()
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
