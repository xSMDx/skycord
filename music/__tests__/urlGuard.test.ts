/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { check, addressBlocked } from '../src/urlGuard'

/**
 * The resolver is injected, so these run with no network and no DNS, and can
 * state exactly what a hostile name answers with.
 */
const resolves = (...addresses: string[]) => async () =>
  addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
const neverResolves = async () => { throw new Error('ENOTFOUND') }

const ok = (url: string, resolve = resolves('93.184.216.34')) => check(url, { resolve })

describe('addressBlocked', () => {
  it('passes ordinary public addresses', () => {
    for (const a of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) {
      expect(addressBlocked(a), a).toBeNull()
    }
  })

  it('blocks every private and special-use IPv4 range', () => {
    const cases: [string, string][] = [
      ['127.0.0.1', 'loopback'],
      ['127.1.2.3', 'anywhere in 127/8, not just .0.1'],
      ['0.0.0.0', 'localhost on Linux'],
      ['10.0.0.5', 'private'],
      ['172.16.0.1', 'private, bottom of the range'],
      ['172.31.255.254', 'private, top of the range — the one off-by-one gets wrong'],
      ['192.168.1.1', 'the home router'],
      ['169.254.169.254', 'cloud metadata'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['224.0.0.1', 'multicast'],
      ['255.255.255.255', 'broadcast'],
    ]
    for (const [ip, why] of cases) expect(addressBlocked(ip), `${ip} — ${why}`).not.toBeNull()
  })

  it('does not block addresses that merely look adjacent to a private range', () => {
    // 172.32 is public; 172.16/12 ends at 172.31.
    for (const a of ['172.32.0.1', '172.15.255.255', '11.0.0.1', '9.255.255.255', '100.63.255.255', '100.128.0.1']) {
      expect(addressBlocked(a), a).toBeNull()
    }
  })

  it('blocks the IPv6 equivalents, including a v4 wearing a v6 coat', () => {
    for (const a of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:192.168.1.1', '::ffff:127.0.0.1', '64:ff9b::1']) {
      expect(addressBlocked(a), a).not.toBeNull()
    }
  })

  it('ignores a zone index rather than being confused by one', () => {
    expect(addressBlocked('fe80::1%eth0')).not.toBeNull()
  })
})

describe('check — the shape of the URL', () => {
  it('takes an ordinary audio URL', async () => {
    const r = await ok('https://cdn.example.com/track.mp3')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.address).toBe('93.184.216.34')
      expect(r.hostname).toBe('cdn.example.com')
      expect(r.port).toBe(443)
    }
  })

  it('refuses a scheme that is not http(s)', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/a.mp3', 'gopher://example.com/a.mp3', 'data:audio/mp3;base64,AAAA']) {
      const r = await ok(u)
      expect(r.ok, u).toBe(false)
    }
  })

  it('refuses credentials in the URL', async () => {
    const r = await ok('https://user:pass@example.com/a.mp3')
    expect(r.ok).toBe(false)
  })

  it('refuses anything that is not an audio file', async () => {
    for (const u of ['https://example.com/', 'https://example.com/index.html', 'https://example.com/a.mp3.exe']) {
      const r = await ok(u)
      expect(r.ok, u).toBe(false)
    }
  })

  it('allows any extension when following a redirect hop', async () => {
    const r = await check('https://example.com/redirector', { resolve: resolves('93.184.216.34'), anyExtension: true })
    expect(r.ok).toBe(true)
  })
})

describe('check — the address is what is judged, not the text', () => {
  it('blocks a literal private address written any way at all', async () => {
    // new URL() normalises these to a literal, so no resolver is consulted.
    for (const u of ['http://127.0.0.1/a.mp3', 'http://[::1]/a.mp3', 'http://192.168.1.1/a.mp3', 'http://[::ffff:10.0.0.1]/a.mp3']) {
      const r = await check(u, { resolve: neverResolves })
      expect(r.ok, u).toBe(false)
    }
  })

  it('blocks a public-looking name that resolves somewhere private', async () => {
    const r = await check('https://totally-fine.example/a.mp3', { resolve: resolves('10.0.0.5') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('10.0.0.5')
  })

  it('blocks a name that answers with one public AND one private address', async () => {
    // The cheapest rebinding setup there is: validate the public one, then
    // let the HTTP client pick either.
    const r = await check('https://split.example/a.mp3', { resolve: resolves('93.184.216.34', '127.0.0.1') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('127.0.0.1')
  })

  it('blocks it in the other order too', async () => {
    const r = await check('https://split.example/a.mp3', { resolve: resolves('127.0.0.1', '93.184.216.34') })
    expect(r.ok).toBe(false)
  })

  it('refuses a name that does not resolve', async () => {
    const r = await check('https://nope.example/a.mp3', { resolve: neverResolves })
    expect(r.ok).toBe(false)
  })

  it('refuses a name that resolves to nothing', async () => {
    const r = await check('https://empty.example/a.mp3', { resolve: async () => [] })
    expect(r.ok).toBe(false)
  })

  it('hands back the address it approved, so the caller never resolves again', async () => {
    const r = await check('https://cdn.example/a.mp3', { resolve: resolves('93.184.216.34', '1.1.1.1') })
    expect(r.ok).toBe(true)
    // This is the whole anti-rebinding contract: connect to THIS, with Host
    // set to the hostname, and do not look the name up a second time.
    if (r.ok) { expect(r.address).toBe('93.184.216.34'); expect(r.hostname).toBe('cdn.example') }
  })
})

/*
 * The mapped-address bug, kept as its own case.
 *
 * A first version of v6Blocked matched only the dotted form ::ffff:10.0.0.1,
 * and new URL() normalises that hostname to ::ffff:a00:1 — so every
 * IPv4-mapped private address went straight through a guard whose unit test
 * said it was blocked, because that test passed the dotted form in directly.
 */
describe('IPv4-mapped addresses survive the URL parser', () => {
  it('blocks them in the hex form the parser actually produces', async () => {
    for (const u of [
      'http://[::ffff:10.0.0.1]/a.mp3',      // -> ::ffff:a00:1
      'http://[::ffff:192.168.1.1]/a.mp3',   // -> ::ffff:c0a8:101
      'http://[::ffff:127.0.0.1]/a.mp3',     // -> ::ffff:7f00:1
      'http://[::ffff:169.254.169.254]/a.mp3',
    ]) {
      const r = await check(u, { resolve: neverResolves })
      expect(r.ok, u).toBe(false)
    }
  })

  it('still allows a mapped PUBLIC address, so the fix is not a blanket ban', async () => {
    // ::ffff:93.184.216.34 -> ::ffff:5db8:d822
    const r = await check('http://[::ffff:93.184.216.34]/a.mp3', { resolve: neverResolves })
    expect(r.ok).toBe(true)
  })
})
