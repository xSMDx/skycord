/**
 * The music service's own HTTP interface.
 *
 * Playback, and ingest. Spoken only by the API. Node's built-in `http` rather
 * than Express on purpose: this is the container that fetches URLs a member
 * typed, and every dependency added to it is more code running next to that
 * capability. A handful of routes do not need a router.
 *
 * ## Who may call this
 *
 * A shared secret in `X-Music-Secret`, compared in constant time. The
 * service binds inside the compose network and publishes no port, so this
 * is defence in depth rather than the only control — but a service whose
 * whole job is "fetch this URL for me" must not take that instruction from
 * anything that can reach its socket.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { timingSafeEqual } from 'crypto'
import type { MusicPublisher } from './publisher.js'
import { check } from './urlGuard.js'
import { fetchFollowing, type Approved } from './safeFetch.js'
import { ingest, type IngestLimits } from './ingest.js'
import { IngestHold } from './ingestHold.js'
import type { ClamConfig } from './clamav.js'
import { Readable } from 'stream'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'

export interface ServerConfig {
  port: number
  host?: string
  secret: string
  maxBytes: number
  /** Where the API answers internal calls. Needed to read library tracks. */
  apiInternalUrl?: string
  /** Ceilings for ingest. Shared with playback where they overlap. */
  ingestLimits?: IngestLimits
  /** Null when no scanner is configured; ingest then reports `skipped`. */
  clam?: ClamConfig | null
  /** Told when a track finishes on its own, so the API can advance its queue. */
  onEnded?: (room: string, channelId: string) => void
  log?: (msg: string) => void
}

const ok = (res: ServerResponse, body: unknown = { ok: true }): void => {
  const json = JSON.stringify(body)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}
const fail = (res: ServerResponse, status: number, reason: string): void => {
  const json = JSON.stringify({ ok: false, reason })
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}

/** Constant time, and length-safe: timingSafeEqual throws on a length mismatch. */
const secretOk = (given: string | string[] | undefined, want: string): boolean => {
  if (typeof given !== 'string' || !want) return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const readJson = (req: IncomingMessage, limit = 16 * 1024): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      // A body cap even here: the caller is trusted, and a trusted caller
      // with a bug should still not be able to exhaust this process.
      if (size > limit) { req.destroy(); reject(new Error('body too large')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })

export const createMusicServer = (pub: MusicPublisher, cfg: ServerConfig): Server => {
  const log = (m: string) => cfg.log?.(m)

  const hold = new IngestHold()
  hold.start()
  const limits: IngestLimits = cfg.ingestLimits ?? {
    maxBytes: cfg.maxBytes,
    maxDurationSec: 30 * 60,
  }

  /**
   * Both ways in converge here, because the bytes are equally untrusted
   * either way: a member who uploads a file is the same member who pastes a
   * link. The only difference is where the stream comes from.
   */
  const runIngest = async (src: NodeJS.ReadableStream, res: ServerResponse): Promise<void> => {
    const out = await ingest(src as never, { limits, clam: cfg.clam ?? null })
    if (!out.ok) return fail(res, 422, out.reason)
    const id = hold.put(out.track, out.cleanup)
    const { audioPath: _audioPath, ...card } = out.track
    ok(res, { ok: true, id, track: card })
  }

  /** Fetch and play, reporting the end so the API can move its queue on. */
  const start = async (room: string, channelId: string, url: string): Promise<void> => {
    const guard = async (u: string) => {
      const r = await check(u, { anyExtension: u !== url })
      return r.ok
        ? { ok: true as const, value: { address: r.address, hostname: r.hostname, port: r.port, href: r.href } as Approved }
        : { ok: false as const, reason: r.reason }
    }

    const got = await fetchFollowing(url, guard, { maxBytes: cfg.maxBytes })
    if (got.kind !== 'stream') {
      log(`${room}/${channelId}: ${got.kind === 'error' ? got.reason : 'unexpected redirect'}`)
      cfg.onEnded?.(room, channelId)        // nothing to play: treat as finished
      return
    }

    const how = await pub.play(room, channelId, got.body)
    if (got.tooBig()) log(`${room}/${channelId}: stopped at the size limit`)
    // 'replaced' means something else is already playing on this channel —
    // reporting an end then would advance a queue that has already moved.
    if (how !== 'replaced') cfg.onEnded?.(room, channelId)
  }

  /**
   * Play a track out of the member's library.
   *
   * The URL guard is deliberately not used here, and that is not a gap.
   * The guard exists because a pasted link is text a member chose, and the
   * attack is making us connect somewhere we should not. This address is
   * not chosen by anyone: the host comes from this container's own
   * `API_INTERNAL_URL`, and the only variable part is an id that has to look
   * like a Mongo ObjectId. Running it through a guard whose whole job is to
   * reject private addresses would reject our own API, which is private by
   * design — so the honest answer is that this path has no untrusted input
   * rather than that it has been checked.
   */
  const startTrack = async (room: string, channelId: string, trackId: string): Promise<void> => {
    const base = cfg.apiInternalUrl
    if (!base) {
      log(`${room}/${channelId}: no API_INTERNAL_URL, cannot read library tracks`)
      cfg.onEnded?.(room, channelId)
      return
    }
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/internal/music/track/${trackId}/audio`, {
        headers: { 'x-music-secret': cfg.secret },
      })
      if (!res.ok || !res.body) {
        log(`${room}/${channelId}: the API answered ${res.status} for track ${trackId}`)
        cfg.onEnded?.(room, channelId)
        return
      }
      const body = Readable.fromWeb(res.body as never)
      const how = await pub.play(room, channelId, body)
      if (how !== 'replaced') cfg.onEnded?.(room, channelId)
    } catch (e) {
      log(`${room}/${channelId}: could not read track ${trackId}: ${String(e).slice(0, 160)}`)
      cfg.onEnded?.(room, channelId)
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://music')

      if (req.method === 'GET' && url.pathname === '/health') return ok(res, { ok: true })

      if (!secretOk(req.headers['x-music-secret'], cfg.secret)) return fail(res, 401, 'not allowed')

      try {
        if (req.method === 'POST' && url.pathname === '/play') {
          const b = await readJson(req) as { room?: string; channelId?: string; url?: string }
          if (!b.room || !b.channelId || !b.url) return fail(res, 400, 'room, channelId and url are required')
          await pub.open(b.room, b.channelId)
          // Answered immediately: a track is minutes long and the API is not
          // going to hold a request open for it. The end arrives by callback.
          ok(res)
          void start(b.room, b.channelId, b.url)
          return
        }

        if (req.method === 'POST' && url.pathname === '/play-track') {
          const b = await readJson(req) as { room?: string; channelId?: string; trackId?: string }
          if (!b.room || !b.channelId || !b.trackId) return fail(res, 400, 'room, channelId and trackId are required')
          // Shape-checked before it is put in a path, even though the API
          // composed it: one hex id is cheaper to verify than to trust.
          if (!/^[0-9a-f]{24}$/i.test(b.trackId)) return fail(res, 400, 'that is not a track id')
          await pub.open(b.room, b.channelId)
          ok(res)
          void startTrack(b.room, b.channelId, b.trackId)
          return
        }

        if (req.method === 'POST' && url.pathname === '/close') {
          const b = await readJson(req) as { room?: string; channelId?: string }
          if (!b.room || !b.channelId) return fail(res, 400, 'room and channelId are required')
          await pub.close(b.room, b.channelId)
          return ok(res)
        }

        // ── ingest ──────────────────────────────────────────────────────
        // Raw bytes on the wire rather than multipart: there is exactly one
        // file and no fields, so a parser would be a dependency bought for
        // nothing in the container that most needs fewer of them.
        if (req.method === 'POST' && url.pathname === '/ingest/upload') {
          await runIngest(req, res)
          return
        }

        if (req.method === 'POST' && url.pathname === '/ingest/link') {
          const b = await readJson(req) as { url?: string }
          if (!b.url) return fail(res, 400, 'url is required')
          const target = b.url
          const guard = async (u: string) => {
            const r = await check(u, { anyExtension: u !== target })
            return r.ok
              ? { ok: true as const, value: { address: r.address, hostname: r.hostname, port: r.port, href: r.href } as Approved }
              : { ok: false as const, reason: r.reason }
          }
          const got = await fetchFollowing(target, guard, { maxBytes: limits.maxBytes })
          if (got.kind !== 'stream') {
            return fail(res, 422, got.kind === 'error' ? got.reason : 'that link did not lead to a file')
          }
          await runIngest(got.body, res)
          return
        }

        // Collection. The file is deleted once it has been handed over —
        // the API is putting it in GridFS and a second copy here is just
        // disk nobody is accounting for.
        if (req.method === 'GET' && /^\/ingest\/[\w-]+\/audio$/.test(url.pathname)) {
          const id = url.pathname.split('/')[2]
          const h = hold.get(id)
          if (!h) return fail(res, 404, 'that upload has expired')
          const size = await stat(h.track.audioPath).catch(() => null)
          if (!size) { await hold.drop(id); return fail(res, 404, 'that upload has expired') }
          res.writeHead(200, {
            'content-type': h.track.mimeType,
            'content-length': String(size.size),
          })
          const file = createReadStream(h.track.audioPath)
          file.pipe(res)
          // Only on a complete hand-over. Dropping on 'close' would delete
          // the file when the API's connection dropped mid-transfer, and
          // its retry would find nothing.
          file.on('end', () => { void hold.drop(id) })
          file.on('error', () => res.destroy())
          return
        }

        if (req.method === 'DELETE' && /^\/ingest\/[\w-]+$/.test(url.pathname)) {
          await hold.drop(url.pathname.split('/')[2])
          return ok(res)
        }

        return fail(res, 404, 'no such endpoint')
      } catch (e) {
        log(`request failed: ${String(e).slice(0, 200)}`)
        return fail(res, 400, 'bad request')
      }
    })()
  })

  server.listen(cfg.port, cfg.host ?? '0.0.0.0', () => log(`listening on ${cfg.host ?? '0.0.0.0'}:${cfg.port}`))
  return server
}
