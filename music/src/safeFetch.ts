/**
 * Fetch a URL the guard has already approved.
 *
 * Split from `urlGuard` on purpose. The guard decides *whether*, this decides
 * *how*, and keeping them apart is what makes both testable: the guard needs
 * no network, and this needs no DNS because it is handed an address.
 *
 * Three things it must get right, each of which is a way the guard's work
 * gets thrown away:
 *
 *  1. **Connect to the approved IP, not the hostname.** Handing the hostname
 *     to the HTTP client means the client resolves it again, and a resolver
 *     under the attacker's control can answer differently the second time.
 *     That is DNS rebinding, and it defeats any amount of prior validation.
 *     So: `host` is the address, `Host:` is the name, and for TLS
 *     `servername` is the name so SNI and certificate validation still work.
 *
 *  2. **Redirects are not followed.** A 302 to `http://192.168.1.1/` turns one
 *     approved fetch into an unapproved one. This returns the location and
 *     stops; the caller runs it through the guard again, with a hop limit.
 *
 *  3. **The byte cap is counted, not asked for.** `Content-Length` is a claim
 *     by the server being fetched. The only number that means anything is the
 *     one counted off the socket, and the socket is destroyed when it is
 *     exceeded — not after the body is in memory.
 */
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { Transform } from 'stream'
import type { Readable } from 'stream'

export interface Approved {
  address: string
  hostname: string
  port: number
  href: string
}

export interface FetchOptions {
  maxBytes: number
  /** Milliseconds to the first byte. Not a cap on the whole stream. */
  timeoutMs?: number
}

export type FetchResult =
  | {
      kind: 'stream'; status: number; contentType: string | null; body: Readable
      /** True once the byte cap cut the stream short. Ask after it ends. */
      tooBig: () => boolean
    }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'error'; reason: string; status?: number }

const DEFAULT_TIMEOUT = 10_000

/** Audio types the service will accept. A page served as HTML is not one. */
const AUDIO_TYPE = /^(audio\/|application\/(ogg|octet-stream)$)/i

export const fetchApproved = (approved: Approved, opts: FetchOptions): Promise<FetchResult> =>
  new Promise((resolve) => {
    let url: URL
    try { url = new URL(approved.href) } catch { return resolve({ kind: 'error', reason: 'bad url' }) }
    const secure = url.protocol === 'https:'
    const send = secure ? httpsRequest : httpRequest

    const req = send({
      // The approved address. Never approved.hostname — see note 1.
      host: approved.address,
      port: approved.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        // The name the certificate and the origin server expect.
        Host: approved.hostname,
        'User-Agent': 'Skycord-Music/1',
        Accept: 'audio/*,application/ogg;q=0.9,*/*;q=0.1',
        'Accept-Encoding': 'identity',
      },
      // SNI and certificate validation still go by name, or every https
      // fetch by IP would fail verification.
      ...(secure ? { servername: approved.hostname } : {}),
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    }, (res) => {
      const status = res.statusCode ?? 0

      if (status >= 300 && status < 400) {
        const location = res.headers.location
        res.resume()                       // drain, do not leak the socket
        return resolve(location
          ? { kind: 'redirect', status, location }
          : { kind: 'error', reason: `redirect with no location`, status })
      }
      if (status !== 200 && status !== 206) {
        res.resume()
        return resolve({ kind: 'error', reason: `the server answered ${status}`, status })
      }

      const type = (res.headers['content-type'] ?? '').split(';')[0].trim() || null
      if (type && !AUDIO_TYPE.test(type)) {
        res.resume()
        return resolve({ kind: 'error', reason: `that is ${type}, not audio`, status })
      }

      /*
       * Counted off the socket, through a Transform rather than a listener.
       *
       * Content-Length is the fetched server's claim and may be absent, a
       * lie, or smaller than what it then sends. Counting as it arrives is
       * the only version that holds, and destroying the socket at the limit
       * is what stops a 100 MB cap from buffering 4 GB first.
       *
       * It must be a Transform and not `res.on('data')`: attaching a data
       * listener puts the response into flowing mode immediately, so the
       * body drains — and ends — before the caller this function returns to
       * has attached anything. The first version did exactly that and handed
       * back an empty, already-finished stream. A Transform counts in the
       * middle of a pipe and keeps backpressure, so nothing moves until the
       * consumer pulls.
       */
      let seen = 0
      let cut = false
      const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          if (cut) { done(); return }
          seen += chunk.length
          if (seen > opts.maxBytes) {
            cut = true
            res.destroy()
            req.destroy()
            this.push(null)        // a clean end, not an error — see below
            done()
            return
          }
          done(null, chunk)
        },
      })
      /*
       * Hitting the cap ends the stream cleanly and sets `tooBig`, rather
       * than erroring it.
       *
       * Erroring looks right and is not. An errored stream emits error and
       * close the moment the cap is hit, which for a fast source is before
       * the caller this function is still returning to has attached a single
       * listener — so the consumer waits forever on an `end` that already
       * happened. The first version did that and hung every oversize fetch.
       *
       * It is also wrong for the consumer: this body is piped into a decoder,
       * and a decoder wants a stream that stops, not one that throws. So the
       * stream ends, and whether it ended early is a question the caller asks.
       */
      res.on('error', () => { if (!cut) counter.destroy() })
      res.pipe(counter)

      resolve({ kind: 'stream', status, contentType: type, body: counter, tooBig: () => cut })
    })

    req.on('timeout', () => { req.destroy(); resolve({ kind: 'error', reason: 'the server did not answer in time' }) })
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ kind: 'error', reason: e.code ?? e.message }))
    req.end()
  })

/**
 * Follow a chain, re-approving every hop.
 *
 * `guard` is injected rather than imported so this stays testable without a
 * resolver, and so the caller — not this file — decides what "approved"
 * means.
 */
export const fetchFollowing = async (
  start: string,
  guard: (url: string) => Promise<{ ok: true; value: Approved } | { ok: false; reason: string }>,
  opts: FetchOptions & { maxHops?: number },
): Promise<FetchResult> => {
  const maxHops = opts.maxHops ?? 4
  let current = start

  for (let hop = 0; hop <= maxHops; hop++) {
    const approved = await guard(current)
    if (!approved.ok) return { kind: 'error', reason: approved.reason }

    const res = await fetchApproved(approved.value, opts)
    if (res.kind !== 'redirect') return res

    // Relative locations are legal and common.
    try { current = new URL(res.location, current).href }
    catch { return { kind: 'error', reason: 'the redirect went somewhere unreadable' } }
  }
  return { kind: 'error', reason: `that link redirects more than ${maxHops} times` }
}
