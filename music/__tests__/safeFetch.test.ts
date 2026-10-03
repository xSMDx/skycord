/// <reference types="node" />
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { fetchApproved, fetchFollowing, type Approved } from '../src/safeFetch'

/**
 * A real socket, against a real local server.
 *
 * The thing being tested is how this talks to a server — the Host header, a
 * redirect not being followed, bytes counted off the wire — and none of that
 * survives being mocked. The guard is what keeps 127.0.0.1 out of production;
 * here it is exactly what we need to reach.
 */
let server: Server
let port = 0
let lastHost: string | undefined

const bodyOf = async (r: { kind: string } & Record<string, unknown>): Promise<Buffer> => {
  const chunks: Buffer[] = []
  await new Promise<void>((done) => {
    const s = r.body as NodeJS.ReadableStream
    s.on('data', (c: Buffer) => chunks.push(c))
    s.on('end', () => done())
    s.on('close', () => done())
    s.on('error', () => done())
  })
  return Buffer.concat(chunks)
}

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHost = req.headers.host
    const url = new URL(req.url ?? '/', 'http://x')
    switch (url.pathname) {
      case '/ok.mp3':
        res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end('audio-bytes'); return
      case '/big.mp3':
        res.writeHead(200, { 'content-type': 'audio/mpeg' })
        // Far more than any cap a test sets, sent in chunks.
        for (let i = 0; i < 200; i++) res.write(Buffer.alloc(1024, 1))
        res.end(); return
      case '/lying.mp3':
        // Claims to be tiny, sends a lot. Content-Length must not be trusted.
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '5' })
        for (let i = 0; i < 100; i++) res.write(Buffer.alloc(1024, 1))
        res.end(); return
      case '/html.mp3':
        res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>not audio</h1>'); return
      case '/gone.mp3':
        res.writeHead(404); res.end('no'); return
      case '/hop1.mp3':
        res.writeHead(302, { location: `http://127.0.0.1:${port}/ok.mp3` }); res.end(); return
      case '/relative.mp3':
        res.writeHead(302, { location: '/ok.mp3' }); res.end(); return
      case '/nowhere.mp3':
        res.writeHead(302); res.end(); return
      case '/loop.mp3':
        res.writeHead(302, { location: `http://127.0.0.1:${port}/loop.mp3` }); res.end(); return
      default:
        res.writeHead(404); res.end()
    }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>(done => { server.close(() => done()) }))

const approved = (path: string, hostname = 'cdn.example.com'): Approved => ({
  address: '127.0.0.1', hostname, port, href: `http://${hostname}:${port}${path}`,
})

describe('fetchApproved', () => {
  it('fetches the body', async () => {
    const r = await fetchApproved(approved('/ok.mp3'), { maxBytes: 1_000_000 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') {
      expect(r.contentType).toBe('audio/mpeg')
      expect((await bodyOf(r)).toString()).toBe('audio-bytes')
    }
  })

  it('connects to the approved address but sends the approved NAME as Host', async () => {
    // This is the whole anti-rebinding contract. The socket went to
    // 127.0.0.1; the origin server must still believe it is cdn.example.com,
    // or virtual hosting and certificates break.
    await fetchApproved(approved('/ok.mp3', 'cdn.example.com'), { maxBytes: 1_000_000 })
    expect(lastHost).toBe('cdn.example.com')
  })

  it('does NOT follow a redirect — it reports it', async () => {
    const r = await fetchApproved(approved('/hop1.mp3'), { maxBytes: 1_000_000 })
    expect(r.kind).toBe('redirect')
    if (r.kind === 'redirect') expect(r.location).toContain('/ok.mp3')
  })

  it('refuses a non-audio content type', async () => {
    const r = await fetchApproved(approved('/html.mp3'), { maxBytes: 1_000_000 })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toContain('text/html')
  })

  it('reports a non-200', async () => {
    const r = await fetchApproved(approved('/gone.mp3'), { maxBytes: 1_000_000 })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.status).toBe(404)
  })

  it('stops a body that exceeds the cap', async () => {
    const r = await fetchApproved(approved('/big.mp3'), { maxBytes: 4096 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') {
      const body = await bodyOf(r)
      // Destroyed at the limit, so what arrives is bounded — not the 200 KB
      // the server wanted to send.
      expect(body.length).toBeLessThan(40_000)
    }
  })

  it('counts bytes off the wire rather than believing Content-Length', async () => {
    // The server claims 5 bytes and sends 100 KB. A cap read from the header
    // would let the whole thing through.
    const r = await fetchApproved(approved('/lying.mp3'), { maxBytes: 4096 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') expect((await bodyOf(r)).length).toBeLessThan(40_000)
  })

  it('reports a connection that goes nowhere', async () => {
    const r = await fetchApproved(
      { address: '127.0.0.1', hostname: 'x.example', port: 1, href: 'http://x.example:1/a.mp3' },
      { maxBytes: 1000, timeoutMs: 1500 },
    )
    expect(r.kind).toBe('error')
  })
})

describe('fetchFollowing', () => {
  const allow = async (url: string) => {
    const u = new URL(url)
    return { ok: true as const, value: { address: '127.0.0.1', hostname: u.hostname, port, href: url } }
  }

  it('follows a hop and fetches the destination', async () => {
    const r = await fetchFollowing(`http://cdn.example.com:${port}/hop1.mp3`, allow, { maxBytes: 1_000_000 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') expect((await bodyOf(r)).toString()).toBe('audio-bytes')
  })

  it('resolves a relative Location', async () => {
    const r = await fetchFollowing(`http://cdn.example.com:${port}/relative.mp3`, allow, { maxBytes: 1_000_000 })
    expect(r.kind).toBe('stream')
  })

  it('re-approves every hop, so a redirect somewhere private is refused', async () => {
    // The guard says yes to the first URL and no to whatever it redirects
    // to. This is the case the whole function exists for.
    const guard = async (url: string) =>
      url.includes('/hop1.mp3')
        ? { ok: true as const, value: { address: '127.0.0.1', hostname: 'cdn.example.com', port, href: url } }
        : { ok: false as const, reason: 'resolves to 192.168.1.1: not a public address' }

    const r = await fetchFollowing(`http://cdn.example.com:${port}/hop1.mp3`, guard, { maxBytes: 1_000_000 })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toContain('192.168.1.1')
  })

  it('gives up on a redirect loop instead of spinning', async () => {
    const r = await fetchFollowing(`http://cdn.example.com:${port}/loop.mp3`, allow, { maxBytes: 1_000_000, maxHops: 3 })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toContain('redirects')
  })

  it('reports a redirect with no destination', async () => {
    const r = await fetchFollowing(`http://cdn.example.com:${port}/nowhere.mp3`, allow, { maxBytes: 1_000_000 })
    expect(r.kind).toBe('error')
  })
})

/*
 * The cap ends the stream rather than erroring it.
 *
 * An errored stream emits error and close the instant the cap is hit — for a
 * fast source, before the caller has attached a listener — so the consumer
 * waits forever on an `end` that already happened. The first version did
 * that and hung every oversize fetch. `tooBig()` is how the caller learns,
 * after the stream is done.
 */
describe('the byte cap reports itself', () => {
  it('says tooBig after cutting a stream short', async () => {
    const r = await fetchApproved(approved('/big.mp3'), { maxBytes: 4096 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') {
      await bodyOf(r)
      expect(r.tooBig()).toBe(true)
    }
  })

  it('says tooBig is false for a body that fitted', async () => {
    const r = await fetchApproved(approved('/ok.mp3'), { maxBytes: 1_000_000 })
    expect(r.kind).toBe('stream')
    if (r.kind === 'stream') {
      expect((await bodyOf(r)).toString()).toBe('audio-bytes')
      expect(r.tooBig()).toBe(false)
    }
  })
})
