/**
 * User-Agent parsing.
 *
 * The screen this feeds asks one question — "is that row me?" — and a wrong
 * label answers it wrongly, which is worse than no label. So the cases below
 * are mostly the ones where a naive parser lies: every Chromium browser says
 * "Chrome", every WebKit browser says "Safari", Edge says all three, and an
 * Android UA also says "Linux".
 */
import { describe, it, expect } from 'vitest'
import { parseUserAgent } from '../utils/userAgent'

const label = (ua: string) => parseUserAgent(ua).label

describe('browsers that impersonate each other', () => {
  it('reads Edge as Edge, not Chrome', () => {
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'))
      .toBe('Edge on Windows')
  })

  it('reads Opera as Opera', () => {
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0 Safari/537.36 OPR/105.0'))
      .toBe('Opera on Windows')
  })

  it('reads Samsung Internet as itself', () => {
    expect(label('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36'))
      .toBe('Samsung Internet on Android')
  })

  it('reads Chrome on iOS, which is WebKit and claims Safari', () => {
    expect(label('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1'))
      .toBe('Chrome on iOS')
  })

  it('still reads plain Safari as Safari', () => {
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15'))
      .toBe('Safari on macOS')
  })
})

describe('operating systems', () => {
  it('reads Android before Linux — the UA contains both', () => {
    expect(label('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'))
      .toBe('Chrome on Android')
  })

  it('separates iPhone from Mac', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1').os)
      .toBe('iOS')
  })

  it('reads a plain desktop Linux', () => {
    expect(label('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'))
      .toBe('Chrome on Linux')
  })
})

describe('device kind', () => {
  const kind = (ua: string) => parseUserAgent(ua).kind

  it('calls a phone mobile', () => {
    expect(kind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1')).toBe('mobile')
  })

  it('calls an iPad a tablet', () => {
    expect(kind('Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('tablet')
  })

  it('calls a desktop a desktop', () => {
    expect(kind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('desktop')
  })
})

describe('things that are not browsers but hold cookies', () => {
  it('names curl rather than guessing', () => {
    expect(parseUserAgent('curl/8.4.0').browser).toBe('Command line')
  })
})

describe('when it cannot tell', () => {
  it('says unknown instead of inventing a name', () => {
    // A confidently wrong label defeats the purpose of the screen.
    expect(label('')).toBe('Unknown device')
    expect(label(undefined)).toBe('Unknown device')
    expect(label('AAAAAAAA')).toBe('Unknown device')
  })

  it('names whichever half it could read', () => {
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
  })

  it('does not blow up on a hostile header', () => {
    // It comes straight off the wire, so it is whatever the caller sent.
    const evil = 'x'.repeat(50_000)
    expect(() => parseUserAgent(evil)).not.toThrow()
    expect(parseUserAgent(evil).label).toBe('Unknown device')
  })
})
