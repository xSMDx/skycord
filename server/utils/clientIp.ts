/**
 * The address the request actually came from.
 *
 * `req.ip` is not it, on this deployment. Express is configured with
 * `trust proxy: 1`, which tells it to skip exactly ONE hop from the right of
 * `X-Forwarded-For`. Behind Cloudflare that chain is:
 *
 *     X-Forwarded-For: <real client>, <cloudflare edge>
 *     socket.remoteAddress: 127.0.0.1   (nginx)
 *
 * so skipping one hop lands on the Cloudflare edge, and every session in the
 * devices list would show a Cloudflare datacentre and its flag. Correct for
 * rate limiting — which only needs a stable key — and wrong for anything a
 * person reads.
 *
 * `CF-Connecting-IP` is the header Cloudflare sets to the true client, and it
 * is the one to use when Cloudflare is in front. It is also trivially spoofable
 * by anyone who can reach the origin directly, which is why it is opt-in
 * (TRUST_CF_IP) rather than "use it if present": on a box whose origin port is
 * open to the internet, trusting it lets a caller write any address they like
 * into their own session row.
 */
import type { Request } from 'express'
import { isIP } from 'node:net'
import { config } from '../config/env'

/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`) reads as noise in a UI. */
const unmap = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip)

export const clientIp = (req: Request): string => {
  if (config.trustCloudflareIp) {
    const cf = req.headers['cf-connecting-ip']
    const v = Array.isArray(cf) ? cf[0] : cf
    if (v && isIP(v)) return unmap(v)
  }
  return unmap(req.ip || req.socket?.remoteAddress || '')
}

/**
 * A loopback or private address means the request never crossed the internet —
 * a reverse proxy that forwards no headers, or local development. Worth
 * knowing, because geo lookup on one of these is guaranteed to miss and the UI
 * should say "local network" rather than show a blank flag.
 */
export const isPrivateIp = (ip: string): boolean => {
  if (!ip) return true
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
         (a === 169 && b === 254)
}
