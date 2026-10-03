/**
 * The music service's own HTTP interface.
 *
 * Three endpoints, spoken only by the API. Node's built-in `http` rather
 * than Express on purpose: this is the container that fetches URLs a member
 * typed, and every dependency added to it is more code running next to that
 * capability. Three routes do not need a router.
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

export interface ServerConfig {
  port: number
  host?: string
  secret: string
  maxBytes: number
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

        if (req.method === 'POST' && url.pathname === '/close') {
          const b = await readJson(req) as { room?: string; channelId?: string }
          if (!b.room || !b.channelId) return fail(res, 400, 'room and channelId are required')
          await pub.close(b.room, b.channelId)
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
