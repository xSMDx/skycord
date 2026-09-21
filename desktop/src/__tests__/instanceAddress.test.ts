import { describe, it, expect } from 'vitest'
import { normaliseAddress, lookupInstance } from '../instanceAddress'

describe('normaliseAddress', () => {
  it('assumes https when no scheme is written', () => {
    expect(normaliseAddress('chat.example.com')).toBe('https://chat.example.com')
    expect(normaliseAddress('  chat.example.com  ')).toBe('https://chat.example.com')
  })

  it('keeps an explicit http, for a server on the local network', () => {
    expect(normaliseAddress('http://192.168.1.5:3001')).toBe('http://192.168.1.5:3001')
  })

  it('reduces an address to its origin: no path, query or trailing slash', () => {
    expect(normaliseAddress('https://chat.example.com/channels/42?x=1#y')).toBe('https://chat.example.com')
    expect(normaliseAddress('chat.example.com/')).toBe('https://chat.example.com')
  })

  it('refuses anything that is not an http(s) address', () => {
    for (const bad of ['', '   ', 'chat example.com', 'javascript:alert(1)', 'file:///C:/x', 'ftp://example.com', 'https://'])
      expect(normaliseAddress(bad), bad).toBeNull()
  })
})

const profile = { software: 'skycord', name: 'Sky Den', nameIsAddress: false, icon: null, operator: 'Sam', version: 'v0.20.0' }
const reply = (status: number, body: unknown) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('lookupInstance', () => {
  it('accepts a server that answers as a Skycord instance', async () => {
    const r = await lookupInstance('chat.example.com', reply(200, profile))
    expect(r).toMatchObject({ ok: true, origin: 'https://chat.example.com' })
    if (r.ok) expect(r.profile.name).toBe('Sky Den')
  })

  it('asks the address it was given, at /instance', async () => {
    let asked = ''
    await lookupInstance('https://chat.example.com/some/page', async (url) => { asked = String(url); return new Response(JSON.stringify(profile)) })
    expect(asked).toBe('https://chat.example.com/instance')
  })

  it('refuses, with a reason a person can act on, every way it can go wrong', async () => {
    const cases: [string, Parameters<typeof lookupInstance>[1]][] = [
      ['not a Skycord profile', reply(200, { hello: 'world' })],
      ['not JSON at all', reply(200, '<html>parked domain</html>')],
      ['a 404', reply(404, 'Not found')],
      ['a 500', reply(500, 'oops')],
      ['a network error', async () => { throw new TypeError('fetch failed') }],
    ]
    for (const [label, fetchImpl] of cases) {
      const r = await lookupInstance('chat.example.com', fetchImpl)
      expect(r.ok, label).toBe(false)
      if (!r.ok) {
        expect(r.reason.length, label).toBeGreaterThan(10)
        expect(r.reason, label).not.toMatch(/at \w+ \(|TypeError|stack/i)
      }
    }
  })

  it('refuses an address before asking anything', async () => {
    let called = false
    const r = await lookupInstance('javascript:alert(1)', async () => { called = true; return new Response('{}') })
    expect(r.ok).toBe(false)
    expect(called).toBe(false)
  })
})
