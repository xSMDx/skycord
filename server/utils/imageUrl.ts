/**
 * Validation for user-supplied image references — avatars, banners, stickers.
 *
 * These are stored as plain strings and rendered into `<img src>`, so two
 * different things need checking and only one of them is about markup:
 *
 *  1. **The scheme.** `data:image/…` from the cropper and `https://` from a GIF
 *     picker are the only two shapes the app ever produces. Everything else —
 *     `javascript:`, `data:text/html`, plain `http:` — was previously accepted
 *     because the only check was on length.
 *
 *  2. **The host**, which is a privacy question rather than a markup one. An
 *     avatar pointing at a server the setter controls hands that server the IP,
 *     User-Agent and viewing time of everyone who looks at the profile. That is
 *     the classic tracking-pixel technique, and no amount of HTML escaping
 *     touches it.
 *
 * SVG is excluded deliberately. It is inert inside `<img>`, where all of these
 * are rendered today — but it carries script, and the day someone renders one
 * through `<object>` or inline, the hole opens with no code change here to
 * suggest it was ever load-bearing.
 */
import { config } from '../config/env'

/** Raster formats only. See the note above on SVG. */
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i

export type ImageUrlResult =
  | { ok: true; value: string }
  | { ok: false; reason: string }

/**
 * @param raw    the candidate string
 * @param maxLen byte ceiling, so one paste cannot push a document toward
 *               Mongo's 16MB limit
 */
export const validateImageUrl = (raw: unknown, maxLen: number): ImageUrlResult => {
  const s = String(raw ?? '')
  if (!s) return { ok: false, reason: 'That image is empty' }
  if (s.length > maxLen) return { ok: false, reason: 'That image is too large' }

  if (s.startsWith('data:')) {
    return DATA_IMAGE.test(s)
      ? { ok: true, value: s }
      : { ok: false, reason: 'That image format is not supported' }
  }

  let u: URL
  try { u = new URL(s) } catch { return { ok: false, reason: 'That is not a valid image link' } }

  // https only. Plain http would also be blocked by the browser as mixed
  // content on any real deployment, so accepting it only stores something that
  // silently fails to load.
  if (u.protocol !== 'https:') return { ok: false, reason: 'Image links must use https' }

  const allow = config.media.imageHosts
  if (allow.length === 0) return { ok: true, value: s }

  // Suffix match on a dot boundary, so `evil-klipy.com` does not pass a
  // `klipy.com` entry while `cdn.klipy.com` does.
  const host = u.hostname.toLowerCase()
  const permitted = allow.some(h => host === h || host.endsWith('.' + h))
  return permitted
    ? { ok: true, value: s }
    : { ok: false, reason: 'Image links from that site are not allowed here' }
}
