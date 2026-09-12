import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import express from 'express'
import request from 'supertest'
import { mountClient, API_PREFIXES } from '../utils/serveClient'
import { notFound } from '../middleware/errorHandler'

let dir = ''
let srv: express.Express

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'skycord-client-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Skycord</title>')
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'mic-gate-worklet.js'), '// worklet')

  srv = express()
  // Stands in for the real API, mounted before the client as in app.ts.
  srv.get('/servers/mine', (_req, res) => { res.json({ ok: true }) })
  mountClient(srv, dir)
  srv.use(notFound)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serving the client', () => {
  it('answers a deep link with the app, uncached', async () => {
    const res = await request(srv).get('/channels/123').set('Accept', 'text/html')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toContain('no-cache')
    expect(res.text).toContain('Skycord')
  })

  it('lets the browser keep a hashed asset forever', async () => {
    const res = await request(srv).get('/assets/index-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.headers['cache-control']).toContain('max-age=31536000')
  })

  it('serves the other files the build produces', async () => {
    const res = await request(srv).get('/mic-gate-worklet.js')
    expect(res.status).toBe(200)
    expect(res.text).toContain('worklet')
  })

  it('leaves the API to answer its own paths', async () => {
    expect((await request(srv).get('/servers/mine')).body).toEqual({ ok: true })
    const missing = await request(srv).get('/messages/nope').set('Accept', 'text/html')
    expect(missing.status).toBe(404)
    expect(missing.headers['content-type']).toContain('json')
  })

  it('answers a missing file with 404, never with the app', async () => {
    const asset = await request(srv).get('/assets/gone.js')
    expect(asset.status).toBe(404)
    expect(asset.headers['content-type'] ?? '').not.toContain('text/html')
    const root = await request(srv).get('/gone.js').set('Accept', 'text/html')
    expect(root.status).toBe(404)
  })

  it('serves nothing that is not in the client folder', async () => {
    const res = await request(srv).get('/server/index.js')
    expect(res.headers['content-type'] ?? '').not.toContain('javascript')
  })

  it('knows every API prefix the app mounts', () => {
    const source = readFileSync(join(__dirname, '..', 'app.ts'), 'utf8')
    const mounted = [...source.matchAll(/app\.use\('(\/[a-z]+)'/g)].map(m => m[1])
    expect(mounted.length).toBeGreaterThan(5)
    for (const prefix of mounted) expect(API_PREFIXES).toContain(prefix)
  })
})
