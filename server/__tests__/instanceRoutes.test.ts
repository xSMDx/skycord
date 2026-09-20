import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app'
import { config } from '../config/env'

// createApp builds the /instance router from process.env and INSTANCE_DIR, so
// each test sets them first and builds its own app. No database is needed.
const KEYS = ['INSTANCE_DIR', 'INSTANCE_NAME', 'TERMS_URL', 'PRIVACY_URL', 'GUIDELINES_URL'] as const
let dir: string
let saved: Partial<Record<(typeof KEYS)[number], string>>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skycord-instance-'))
  saved = {}
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key] }
  process.env.INSTANCE_DIR = dir
})
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

const api = () => request(createApp())

describe('GET /instance', () => {
  it('answers with the profile when nothing is configured', async () => {
    const res = await api().get('/instance')
    expect(res.status).toBe(200)
    expect(res.body.software).toBe('skycord')
    expect(res.body.legal).toEqual([])
    expect(typeof res.body.source).toBe('string')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  it('is readable from any origin, and allows no credentials', async () => {
    const res = await api().get('/instance').set('Origin', 'https://elsewhere.example')
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('answers a preflight from any origin', async () => {
    const res = await api().options('/instance')
      .set('Origin', 'https://elsewhere.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('leaves the rest of the API on its single-origin policy with credentials', async () => {
    const res = await api().get('/health').set('Origin', config.cors.clientOrigin)
    expect(res.headers['access-control-allow-origin']).toBe(config.cors.clientOrigin)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('answers HEAD', async () => {
    expect((await api().head('/instance')).status).toBe(200)
  })

  it('lists published documents in the fixed order', async () => {
    writeFileSync(join(dir, 'imprint.md'), '# Imprint')
    writeFileSync(join(dir, 'terms.md'), '# Terms')
    process.env.PRIVACY_URL = 'https://example.com/privacy'
    const res = await api().get('/instance')
    expect(res.body.legal.map((e: { kind: string }) => e.kind)).toEqual(['terms', 'privacy', 'imprint'])
    expect(res.body.legal[0].href).toBe('/instance/legal/terms')
    expect(res.body.legal[1]).toEqual({ kind: 'privacy', source: 'url', href: 'https://example.com/privacy' })
  })
})

describe('GET /instance/legal/:kind', () => {
  it('serves a published document as Markdown', async () => {
    writeFileSync(join(dir, 'terms.md'), '# Terms\n\nBe kind.')
    const res = await api().get('/instance/legal/terms')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.text).toBe('# Terms\n\nBe kind.')
  })

  it('answers 404 for a document published as a link, and for one not published', async () => {
    process.env.PRIVACY_URL = 'https://example.com/privacy'
    expect((await api().get('/instance/legal/privacy')).status).toBe(404)
    expect((await api().get('/instance/legal/cookies')).status).toBe(404)
  })

  // Every traversal below is written so a URL parser cannot defuse it before
  // the request is sent. A bare '%2e%2e' is a complete dot-segment, and the
  // WHATWG parser inside supertest collapses it to '/instance/' on the client
  // — that probe would have tested the client, not this router. Keeping the
  // slash encoded holds the whole attempt inside one path segment, which is
  // exactly what reaches :kind.
  it('answers 404 for an unknown kind and never lets a path through', async () => {
    writeFileSync(join(dir, 'terms.md'), '# Terms')
    for (const path of ['/instance/legal/unknown', '/instance/legal/..%2fterms', '/instance/legal/terms.md', '/instance/legal/%2e%2e%2fterms', '/instance/legal/%2e%2e%2f%2e%2e%2fpackage.json']) {
      const res = await api().get(path)
      expect(res.status, path).toBe(404)
      expect(res.headers['access-control-allow-origin'], path).toBe('*')
    }
  })
})

describe('GET /instance/icon', () => {
  it('serves the icon with its own type, nosniff and an hour of caching', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(join(dir, 'icon.png'), png)
    const res = await api().get('/instance/icon')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(Buffer.compare(res.body as Buffer, png)).toBe(0)
  })

  it('answers 404 when there is none, and when the only one is over 512 KB', async () => {
    expect((await api().get('/instance/icon')).status).toBe(404)
    writeFileSync(join(dir, 'icon.jpg'), Buffer.alloc(512 * 1024 + 1))
    expect((await api().get('/instance/icon')).status).toBe(404)
  })
})

describe('the rate limit', () => {
  // Every limiter in this project skips itself under Vitest (rateLimit.ts,
  // `skip: () => !!process.env.VITEST`), so the limit cannot be exercised
  // here. What can be held is that the router applies it and what it is.
  it('is 120 a minute and applied to every /instance route', () => {
    const limits = readFileSync(join(__dirname, '..', 'middleware', 'rateLimit.ts'), 'utf8')
    const router = readFileSync(join(__dirname, '..', 'routes', 'instance.ts'), 'utf8')
    expect(limits).toMatch(/export const instanceLimit = make\(60_000, 120,/)
    expect(router).toMatch(/router\.use\(instanceLimit\)/)
  })
})
