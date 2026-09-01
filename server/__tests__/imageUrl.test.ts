/**
 * Validation for user-supplied image references.
 *
 * Length was previously the ONLY check on an avatar or banner, and stickers
 * checked a `data:image/` prefix that admits svg+xml. None of these reach an
 * HTML context — they render into `<img src>` — so this is not about markup
 * escaping. It is about two other things:
 *
 *  - a remote host of the setter's choosing collects the IP, User-Agent and
 *    viewing time of everyone who looks at that profile;
 *  - SVG carries script, and is inert only for as long as every render site
 *    stays an `<img>`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateImageUrl } from '../utils/imageUrl'
import { config } from '../config/env'

const MB = 1_000_000
const ok = (r: ReturnType<typeof validateImageUrl>) => r.ok
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('data URLs', () => {
  it('accepts the raster formats a cropper produces', () => {
    for (const t of ['png', 'jpeg', 'jpg', 'gif', 'webp', 'avif']) {
      expect(ok(validateImageUrl(`data:image/${t};base64,AAAA`, MB))).toBe(true)
    }
  })

  it('refuses svg, which carries script', () => {
    // Inert inside <img>, which is where these render today — and a landmine
    // for whoever renders one through <object> or inline instead.
    expect(ok(validateImageUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', MB))).toBe(false)
  })

  it('refuses a non-image data URL', () => {
    expect(ok(validateImageUrl('data:text/html;base64,PHNjcmlwdD4=', MB))).toBe(false)
    expect(ok(validateImageUrl('data:application/javascript;base64,YQ==', MB))).toBe(false)
  })

  it('refuses a data URL that is not base64-shaped', () => {
    expect(ok(validateImageUrl('data:image/png,<svg onload=alert(1)>', MB))).toBe(false)
  })
})

describe('remote URLs', () => {
  it('accepts https', () => {
    expect(ok(validateImageUrl('https://cdn.example.com/a.gif', MB))).toBe(true)
  })

  it('refuses plain http', () => {
    // A browser on HTTPS blocks it as mixed content anyway, so storing it only
    // saves something that silently fails to load.
    expect(ok(validateImageUrl('http://cdn.example.com/a.gif', MB))).toBe(false)
  })

  it('refuses javascript: and other schemes', () => {
    for (const s of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x/y.gif', 'vbscript:x']) {
      expect(ok(validateImageUrl(s, MB))).toBe(false)
    }
  })

  it('refuses something that is not a URL at all', () => {
    expect(ok(validateImageUrl('not a url', MB))).toBe(false)
    expect(ok(validateImageUrl('', MB))).toBe(false)
  })
})

describe('size', () => {
  it('refuses anything past the ceiling', () => {
    expect(ok(validateImageUrl('data:image/png;base64,' + 'A'.repeat(MB), 1000))).toBe(false)
  })
})

describe('the host allowlist', () => {
  const original = [...config.media.imageHosts]
  beforeEach(() => { (config.media as any).imageHosts = ['klipy.com', 'example.org'] })
  afterEach(() => { (config.media as any).imageHosts = original })

  it('accepts a listed host and its subdomains', () => {
    expect(ok(validateImageUrl('https://klipy.com/a.gif', MB))).toBe(true)
    expect(ok(validateImageUrl('https://cdn.klipy.com/a.gif', MB))).toBe(true)
  })

  it('refuses a host that merely ends with the same letters', () => {
    // The match is on a dot boundary, or `evil-klipy.com` would pass a
    // `klipy.com` entry — which is the whole attack.
    expect(ok(validateImageUrl('https://evilklipy.com/a.gif', MB))).toBe(false)
    expect(ok(validateImageUrl('https://evil-klipy.com/a.gif', MB))).toBe(false)
  })

  it('refuses an unlisted host', () => {
    expect(ok(validateImageUrl('https://tracker.example.com/pixel.gif', MB))).toBe(false)
  })

  it('still allows data URLs, which have no host', () => {
    expect(ok(validateImageUrl(png, MB))).toBe(true)
  })

  it('allows any https host when the list is empty', () => {
    // The default, which preserves existing behaviour — and leaves the
    // tracking-pixel problem open until an operator sets IMAGE_HOSTS.
    ;(config.media as any).imageHosts = []
    expect(ok(validateImageUrl('https://anywhere.example/a.gif', MB))).toBe(true)
  })
})
