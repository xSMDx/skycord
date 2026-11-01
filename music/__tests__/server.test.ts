/// <reference types="node" />
/**
 * The service's HTTP interface, with the publisher stubbed.
 *
 * What matters here is the gate and the shapes, not the audio: anything that
 * can reach this socket can ask the service to fetch a URL, so "who may
 * call this" is the whole point of the file under test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'net'
import { createServer, type Server } from 'http'
import { createMusicServer } from '../src/server.js'
import type { MusicPublisher } from '../src/publisher.js'

const SECRET = 'a-shared-secret-of-some-length'

const calls: string[] = []
const ended: string[] = []
/** The channels the stub says have a song it can hold. */
const playingHere = new Set<string>()

/** Enough of a publisher to record what the server asked it to do. */
const stubPublisher = {
  open: async (room: string, id: string) => { calls.push(`open ${room}/${id}`) },
  play: async (room: string, id: string, _body: unknown, startSec = 0) => {
    calls.push(`play ${room}/${id}${startSec ? ` @${startSec}` : ''}`)
    return 'ended' as const
  },
  close: async (room: string, id: string) => { calls.push(`close ${room}/${id}`) },
  pause: (room: string, id: string) => { calls.push(`pause ${room}/${id}`); return playingHere.has(`${room}/${id}`) },
  resume: (room: string, id: string) => { calls.push(`resume ${room}/${id}`); return playingHere.has(`${room}/${id}`) },
} as unknown as MusicPublisher

let server: Server
let base = ''

beforeAll(async () => {
  server = createMusicServer(stubPublisher, {
    port: 0,
    host: '127.0.0.1',
    secret: SECRET,
    maxBytes: 1024,
    onEnded: (room: string, id: string) => ended.push(`${room}/${id}`),
  })
  await new Promise<void>(r => server.listening ? r() : server.once('listening', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(r => { server.close(() => r()) }))

const post = (path: string, body: unknown, secret?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-music-secret': secret } : {}) },
    body: JSON.stringify(body),
  })

describe('the gate', () => {
  it('refuses a call with no secret', async () => {
    const r = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3' })
    expect(r.status).toBe(401)
  })

  it('refuses a wrong secret', async () => {
    const r = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3' }, 'nope')
    expect(r.status).toBe(401)
  })

  it('refuses a secret that is a prefix of the real one', async () => {
    // timingSafeEqual throws on a length mismatch rather than returning
    // false, so the length is checked first. A prefix must not pass.
    const r = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3' }, SECRET.slice(0, -1))
    expect(r.status).toBe(401)
  })

  it('refuses a longer secret that starts with the real one', async () => {
    const r = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3' }, SECRET + 'x')
    expect(r.status).toBe(401)
  })

  it('leaves /health open, because a healthcheck has no secret to give', async () => {
    const r = await fetch(base + '/health')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })
})

describe('/play', () => {
  it('opens the channel and answers without waiting for the track', async () => {
    calls.length = 0
    const r = await post('/play', { room: 'voice:1', channelId: 'chill', url: 'https://cdn.example.com/a.mp3' }, SECRET)
    expect(r.status).toBe(200)
    // A track is minutes long; the request must not be held open for it.
    expect(calls).toContain('open voice:1/chill')
  })

  it('requires room, channelId and url', async () => {
    for (const body of [{}, { room: 'r' }, { room: 'r', channelId: 'c' }, { channelId: 'c', url: 'u' }]) {
      const r = await post('/play', body, SECRET)
      expect(r.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('reports an end when the URL is refused, so a queue does not stall', async () => {
    ended.length = 0
    // A private address: the guard rejects it, nothing plays, and the API
    // still needs to know to move on.
    await post('/play', { room: 'voice:2', channelId: 'c2', url: 'http://192.168.1.1/a.mp3' }, SECRET)
    await new Promise(r => setTimeout(r, 400))
    expect(ended).toContain('voice:2/c2')
  })
})

describe('starting at an offset', () => {
  it('refuses a startSec that is not a whole number of seconds', async () => {
    for (const startSec of [1.5, -1, 'ten', 999_999, null]) {
      const r = await post('/play-track', { room: 'r', channelId: 'c', trackId: 'a'.repeat(24), startSec }, SECRET)
      expect(r.status, JSON.stringify(startSec)).toBe(400)
      const l = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3', startSec }, SECRET)
      expect(l.status, JSON.stringify(startSec)).toBe(400)
    }
  })

  it('accepts a whole number, and no number at all', async () => {
    expect((await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3', startSec: 30 }, SECRET)).status).toBe(200)
    expect((await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3', startSec: 0 }, SECRET)).status).toBe(200)
    expect((await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3' }, SECRET)).status).toBe(200)
  })
})

describe('/close', () => {
  it('closes the channel', async () => {
    calls.length = 0
    const r = await post('/close', { room: 'voice:1', channelId: 'chill' }, SECRET)
    expect(r.status).toBe(200)
    expect(calls).toContain('close voice:1/chill')
  })

  it('requires room and channelId', async () => {
    expect((await post('/close', { room: 'r' }, SECRET)).status).toBe(400)
  })
})

describe('what this service can do', () => {
  it('says it can pause, to the API and nobody else', async () => {
    // The API sends `pausable` only when this answers. An older service has
    // no such route and 404s, which is how the API knows not to.
    expect((await fetch(base + '/capabilities')).status).toBe(401)
    const r = await fetch(base + '/capabilities', { headers: { 'x-music-secret': SECRET } })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ pause: true })
  })
})

describe('/pause and /resume', () => {
  it('hold and release the song on that channel, answering 200 when done', async () => {
    calls.length = 0
    playingHere.add('voice:1/chill')
    expect((await post('/pause', { room: 'voice:1', channelId: 'chill' }, SECRET)).status).toBe(200)
    expect((await post('/resume', { room: 'voice:1', channelId: 'chill' }, SECRET)).status).toBe(200)
    expect(calls).toEqual(['pause voice:1/chill', 'resume voice:1/chill'])
    playingHere.clear()
  })

  it('answer 409 when nothing is playing there to hold', async () => {
    // What a restarted service says: it holds nothing. The API then starts
    // the song again from where the room paused it.
    expect((await post('/pause', { room: 'voice:1', channelId: 'gone' }, SECRET)).status).toBe(409)
    expect((await post('/resume', { room: 'voice:1', channelId: 'gone' }, SECRET)).status).toBe(409)
  })

  it('require room and channelId, and the secret', async () => {
    for (const path of ['/pause', '/resume']) {
      expect((await post(path, { room: 'r' }, SECRET)).status).toBe(400)
      expect((await post(path, { channelId: 'c' }, SECRET)).status).toBe(400)
      expect((await post(path, { room: 'r', channelId: 'c' })).status).toBe(401)
    }
  })
})

describe('a pause while the next song is still being fetched', () => {
  // /play and /play-track answer at once and fetch in the background; the
  // song already playing keeps playing until the new one starts. A pause in
  // that gap would hold the OUTGOING song, the new one would then start
  // unpaused, and the room would show Paused over music. So it is refused,
  // the same "try again in a moment" as a pause at the very start of a song.
  it('is refused, and works again once the new song has started', async () => {
    let release: (() => void) | null = null
    const api = createServer((_req, res) => {
      release = () => {
        if (res.headersSent) return
        res.writeHead(200, { 'content-type': 'audio/webm' }); res.end(Buffer.from('bytes'))
      }
    })
    await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()))
    const svc = createMusicServer(stubPublisher, {
      port: 0, host: '127.0.0.1', secret: SECRET, maxBytes: 1024,
      apiInternalUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    })
    await new Promise<void>(r => svc.listening ? r() : svc.once('listening', () => r()))
    const at = `http://127.0.0.1:${(svc.address() as AddressInfo).port}`
    const send = (path: string, body: unknown) => fetch(at + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-music-secret': SECRET },
      body: JSON.stringify(body),
    })
    const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 20)) }
    try {
      calls.length = 0
      playingHere.add('voice:9/c')                     // the outgoing song, still playing
      expect((await send('/play-track', { room: 'voice:9', channelId: 'c', trackId: 'b'.repeat(24) })).status).toBe(200)
      await waitFor(() => release !== null)            // the read is out, not answered

      const early = await send('/pause', { room: 'voice:9', channelId: 'c' })
      expect(early.status).toBe(409)
      expect(calls).not.toContain('pause voice:9/c')

      release!()
      await waitFor(() => calls.includes('play voice:9/c'))
      expect(calls).toContain('play voice:9/c')
      expect((await send('/pause', { room: 'voice:9', channelId: 'c' })).status).toBe(200)
    } finally {
      playingHere.clear()
      ;(release as (() => void) | null)?.()            // never leave the read hanging
      await new Promise<void>(r => svc.close(() => r()))
      api.closeAllConnections()
      await new Promise<void>(r => api.close(() => r()))
    }
  })
})

describe('everything else', () => {
  it('404s an unknown path', async () => {
    expect((await post('/whatever', {}, SECRET)).status).toBe(404)
  })

  it('refuses a body that is not json', async () => {
    const r = await fetch(base + '/play', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-music-secret': SECRET },
      body: 'not json',
    })
    expect(r.status).toBe(400)
  })

  it('refuses an oversized body rather than buffering it', async () => {
    const r = await fetch(base + '/play', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-music-secret': SECRET },
      body: JSON.stringify({ room: 'r', channelId: 'c', url: 'u', pad: 'x'.repeat(32 * 1024) }),
    }).catch(() => null)
    // Either a 400 or a destroyed connection; both are a refusal.
    expect(r === null || r.status === 400).toBe(true)
  })
})
