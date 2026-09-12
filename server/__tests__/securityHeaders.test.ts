import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)

/**
 * The app owns its security headers, so every deployment gets the same ones:
 * the container behind Caddy, a server behind nginx, and development. When the
 * proxy adds its own set too, browsers receive two conflicting values for the
 * same header — which is how a DENY and a SAMEORIGIN arrive together and the
 * rule stops meaning anything.
 */
describe('security headers', () => {
  it('refuses framing outright, once', async () => {
    const res = await app().get('/health')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('asks browsers to remember HTTPS for two years', async () => {
    const res = await app().get('/health')
    expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains')
  })

  it('turns off the browser features this app never uses', async () => {
    const res = await app().get('/health')
    expect(res.headers['permissions-policy']).toBe('geolocation=(), payment=(), usb=()')
  })

  it('sends no content policy, which here would block fonts, avatars and calls', async () => {
    // Until the app served its own pages, this header only ever rode on API
    // responses, where a policy does nothing. On a page it applies for real,
    // and the default one blocks images from other hosts and connections to a
    // voice server on another address. A policy this app can actually keep
    // needs its own session and a browser to test in.
    const res = await app().get('/health')
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('still keeps the headers that were already right', async () => {
    const res = await app().get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
  })
})
