import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuth, type PublicUser } from '../useAuth'
import {
  library, uploads, uploadBatch, uploadTrack, enqueueUploads, dropUpload, importTrack, retryUploads,
  UPLOAD_STALL_MS,
  type LibTrack,
} from '../useMusicLibrary'
import { NOT_REACHED } from '../uploadScheduler'

/**
 * The upload queue as useMusicLibrary wires it: XHR for the bytes, the
 * session's token for each file, the library for what arrives.
 *
 * The scheduling itself is uploadScheduler's and is tested there. This is
 * the seam — that uploadTrack hands back what the scheduler needs to tell a
 * 429 from a 413 from a dead connection, that a signed-out session stops the
 * queue cold, and that a link import is never stuck behind it.
 */

class FakeXHR {
  static made: FakeXHR[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  withCredentials = false
  status = 0
  responseText = ''
  responseHeaders: Record<string, string> = {}
  aborted = false
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null; onload: (() => void) | null } =
    { onprogress: null, onload: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(method: string, url: string): void { this.method = method; this.url = url }
  setRequestHeader(k: string, v: string): void { this.headers[k] = v }
  getResponseHeader(name: string): string | null {
    const hit = Object.keys(this.responseHeaders).find(k => k.toLowerCase() === name.toLowerCase())
    return hit ? this.responseHeaders[hit] : null
  }
  send(body: unknown): void { this.body = body; FakeXHR.made.push(this) }
  abort(): void { this.aborted = true; this.onabort?.() }

  respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.status = status
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.responseHeaders = headers
    this.onload?.()
  }
  fail(): void { this.onerror?.() }
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
    if (loaded === total) this.upload.onload?.()
  }
}

const track = (id: string, title = id): LibTrack => ({
  id, title, artist: '', album: '', durationSec: 180, bytes: 1000, mimeType: 'audio/ogg',
  source: 'upload', scan: 'clean', cover: null,
} as unknown as LibTrack)

const song = (name: string, bytes = 3) => new File(['x'.repeat(bytes)], name, { type: 'audio/mpeg' })

const { user, accessToken } = useAuth()
const signIn = (id: string, token: string) => {
  user.value = { id, username: id } as PublicUser
  accessToken.value = token
}
const signOut = () => { user.value = null; accessToken.value = null }

const settle = () => vi.advanceTimersByTimeAsync(0)
const realFetch = globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
  FakeXHR.made = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  signOut()
  signIn('u1', 't1')
  library.tracks = []
  library.usage = { tracks: 0, bytes: 0 }
  library.caps = null
  library.error = ''
})
afterEach(() => {
  signOut()
  vi.unstubAllGlobals()
  globalThis.fetch = realFetch
  vi.useRealTimers()
})

describe('uploadTrack', () => {
  it('sends the file itself, with the token and its type', async () => {
    void uploadTrack(song('a.mp3'), 'tok')
    const x = FakeXHR.made[0]
    expect(x.method).toBe('POST')
    expect(x.url).toBe('/music/tracks/upload')
    expect(x.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'audio/mpeg' })
    expect(x.body).toBeInstanceOf(File)
  })

  it('hands back the track it made', async () => {
    const got = uploadTrack(song('a.mp3'), 'tok')
    FakeXHR.made[0].respond(201, { track: track('t1') })
    expect(await got).toEqual({ ok: true, value: track('t1') })
  })

  it('a 429 comes back with its status, its headers and the limiter’s words', async () => {
    const got = uploadTrack(song('a.mp3'), 'tok')
    FakeXHR.made[0].respond(429, { message: 'Too many uploads — wait a moment', code: 'RATE_LIMITED' },
      { 'Retry-After': '41', 'RateLimit-Reset': '41' })
    expect(await got).toEqual({
      ok: false, status: 429,
      headers: { 'retry-after': '41', 'ratelimit-reset': '41' },
      message: 'Too many uploads — wait a moment',
    })
  })

  it('a 413 from a proxy in front comes back readable', async () => {
    const got = uploadTrack(song('a.mp3'), 'tok')
    FakeXHR.made[0].respond(413, '<html>413 Request Entity Too Large</html>')
    expect(await got).toMatchObject({
      ok: false, status: 413,
      message: 'That file is too large for this server. Whoever runs it can raise its upload limit.',
    })
  })

  it('a dead connection comes back as status 0', async () => {
    const got = uploadTrack(song('a.mp3'), 'tok')
    FakeXHR.made[0].fail()
    expect(await got).toMatchObject({ ok: false, status: 0 })
  })

  it('reports how much has gone up, and when all of it has', async () => {
    const seen: number[] = []
    void uploadTrack(song('a.mp3'), 'tok', { onProgress: f => seen.push(f) })
    FakeXHR.made[0].progress(25, 100)
    FakeXHR.made[0].progress(100, 100)
    expect(seen).toEqual([0.25, 1, 1])
  })

  it('gives up on an upload that has stopped moving, as one that never arrived', async () => {
    expect(UPLOAD_STALL_MS).toBe(60_000)
    let got: unknown = null
    void uploadTrack(song('a.mp3'), 'tok').then(a => { got = a })
    const x = FakeXHR.made[0]

    // Moving, however slowly: each sign of progress starts the minute again.
    await vi.advanceTimersByTimeAsync(59_999)
    x.progress(10, 100)
    await vi.advanceTimersByTimeAsync(59_999)
    x.progress(20, 100)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(got).toBeNull()
    expect(x.aborted).toBe(false)

    // A whole minute with nothing: let it go, and say it never got there.
    await vi.advanceTimersByTimeAsync(1)
    expect(x.aborted).toBe(true)
    expect(got).toEqual({ ok: false, status: 0, headers: {}, message: NOT_REACHED })
  })

  it('does not time the server’s checking and converting once every byte is there', async () => {
    let got: unknown = null
    void uploadTrack(song('a.mp3'), 'tok').then(a => { got = a })
    const x = FakeXHR.made[0]
    x.progress(100, 100)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(x.aborted).toBe(false)
    x.respond(201, { track: track('t1') })
    await settle()
    expect(got).toEqual({ ok: true, value: track('t1') })
  })

  it('leaves no watchdog behind, however it ends', async () => {
    const ends: ((x: FakeXHR, stop: AbortController) => void)[] = [
      x => x.respond(201, { track: track('t1') }),
      x => x.respond(500, { message: 'no' }),
      x => x.fail(),
      (_x, stop) => stop.abort(),
    ]
    for (const end of ends) {
      FakeXHR.made = []
      const stop = new AbortController()
      const got = uploadTrack(song('a.mp3'), 'tok', { signal: stop.signal })
      FakeXHR.made[0].progress(5, 100)
      end(FakeXHR.made[0], stop)
      await got
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('stops when asked to', async () => {
    const stop = new AbortController()
    const got = uploadTrack(song('a.mp3'), 'tok', { signal: stop.signal })
    stop.abort()
    expect(FakeXHR.made[0].aborted).toBe(true)
    expect(await got).toMatchObject({ ok: false, status: 0 })
  })
})

describe('the upload queue', () => {
  it('sends each file with the token of the moment, not the one it was added with', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()
    expect(FakeXHR.made).toHaveLength(1)
    expect(FakeXHR.made[0].headers.Authorization).toBe('Bearer t1')

    accessToken.value = 't2'                 // the 14-minute refresh came round
    FakeXHR.made[0].respond(201, { track: track('a') })
    await settle()
    expect(FakeXHR.made[1].headers.Authorization).toBe('Bearer t2')
  })

  it('puts what arrives in the library, once', async () => {
    enqueueUploads([song('a.mp3')])
    await settle()
    // A reload of the list that already has it raced the upload's answer.
    library.tracks = [track('a')]
    library.usage = { tracks: 1, bytes: 1000 }
    FakeXHR.made[0].respond(201, { track: track('a') })
    await settle()
    expect(library.tracks.map(t => t.id)).toEqual(['a'])
    expect(library.usage.tracks).toBe(1)

    enqueueUploads([song('b.mp3')])
    await settle()
    FakeXHR.made[1].respond(201, { track: track('b') })
    await settle()
    expect(library.tracks.map(t => t.id)).toEqual(['b', 'a'])
    expect(library.usage).toEqual({ tracks: 2, bytes: 2000 })
  })

  it('waits out a 429 and sends the same file again', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()
    FakeXHR.made[0].respond(429, { message: 'Too many uploads — wait a moment' }, { 'Retry-After': '20' })
    await settle()
    expect(uploads.map(u => u.state)).toEqual(['limited', 'waiting'])

    await vi.advanceTimersByTimeAsync(20_000)
    expect(FakeXHR.made).toHaveLength(2)
    expect((FakeXHR.made[1].body as File).name).toBe('a.mp3')
  })

  it('signing out stops the batch, clears it, and sends nothing more', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3'), song('c.mp3')])
    await settle()
    const first = FakeXHR.made[0]

    signOut()
    expect(uploads).toEqual([])
    expect(uploadBatch).toEqual({ total: 0, done: 0, held: false })
    expect(first.aborted).toBe(true)

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(FakeXHR.made).toHaveLength(1)
    expect(library.tracks).toEqual([])
  })

  it('signing out while waiting out the limit sends nothing when the wait ends', async () => {
    enqueueUploads([song('a.mp3')])
    await settle()
    FakeXHR.made[0].respond(429, { message: 'Too many uploads — wait a moment' })
    await settle()
    signOut()
    signIn('u2', 'other')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(FakeXHR.made).toHaveLength(1)
    expect(uploads).toEqual([])
  })

  it('switching account clears it too', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()
    signIn('u2', 't-u2')
    expect(uploads).toEqual([])
    expect(FakeXHR.made[0].aborted).toBe(true)
  })

  it('an expired token is refreshed once and the same file sent again', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ accessToken: 't9' }), { status: 200 })) as typeof fetch
    enqueueUploads([song('a.mp3')])
    await settle()
    FakeXHR.made[0].respond(401, { message: 'Token expired' })
    await settle()
    expect(FakeXHR.made).toHaveLength(2)
    expect(FakeXHR.made[1].headers.Authorization).toBe('Bearer t9')
    expect((FakeXHR.made[1].body as File).name).toBe('a.mp3')
  })

  it('leaves out what is not audio, and says so', () => {
    enqueueUploads([song('a.mp3'), new File(['x'], 'cover.jpg', { type: 'image/jpeg' })])
    expect(uploads.map(u => u.name)).toEqual(['a.mp3'])
    expect(library.error).toBe('cover.jpg isn’t an audio file, so it was left out.')

    library.error = ''
    enqueueUploads([new File(['x'], 'a.txt', { type: 'text/plain' }), new File(['x'], 'b.png', { type: 'image/png' })])
    expect(library.error).toBe('2 files aren’t audio, so they were left out.')
  })

  it('fails a file over the server’s limit at once, without sending it', async () => {
    library.caps = { maxUploadBytes: 2 } as typeof library.caps
    enqueueUploads([song('big.mp3', 5), song('small.mp3', 1)])
    await settle()
    expect(uploads.find(u => u.name === 'big.mp3')).toMatchObject({ state: 'failed' })
    expect(uploads.find(u => u.name === 'big.mp3')?.error).toMatch(/too big/)
    expect(FakeXHR.made.map(x => (x.body as File).name)).toEqual(['small.mp3'])
  })

  it('a lost connection holds the batch, and Retry sends the same file again', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()
    FakeXHR.made[0].fail()
    await settle()
    expect(uploadBatch.held).toBe(true)
    expect(uploads.map(u => u.state)).toEqual(['waiting', 'waiting'])
    expect(uploads[0].error).toBe(NOT_REACHED)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(FakeXHR.made).toHaveLength(1)

    retryUploads()
    await settle()
    expect(uploadBatch.held).toBe(false)
    expect(FakeXHR.made).toHaveLength(2)
    expect(FakeXHR.made[1].body).toBe(FakeXHR.made[0].body)
  })

  it('an upload that stalls for a minute holds the batch too', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()
    FakeXHR.made[0].progress(10, 100)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeXHR.made[0].aborted).toBe(true)
    expect(uploadBatch.held).toBe(true)
    expect(FakeXHR.made).toHaveLength(1)
  })

  it('carries on by itself when the connection comes back', async () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    enqueueUploads([song('a.mp3')])
    await settle()
    FakeXHR.made[0].fail()
    await settle()
    expect(uploadBatch.held).toBe(true)

    win.dispatchEvent(new Event('online'))
    await settle()
    expect(uploadBatch.held).toBe(false)
    expect(FakeXHR.made).toHaveLength(2)

    // Not held any more, so it is not listening: coming online again sends nothing.
    FakeXHR.made[1].respond(201, { track: track('a') })
    await settle()
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(FakeXHR.made).toHaveLength(2)
  })

  it('stops listening for the connection once signed out', async () => {
    const win = new EventTarget()
    const off = vi.spyOn(win, 'removeEventListener')
    vi.stubGlobal('window', win)
    enqueueUploads([song('a.mp3')])
    await settle()
    FakeXHR.made[0].fail()
    await settle()
    signOut()
    expect(off).toHaveBeenCalledWith('online', expect.any(Function))
    signIn('u1', 't1')
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(FakeXHR.made).toHaveLength(1)
  })

  it('dropUpload removes a waiting file before it is sent', async () => {
    enqueueUploads([song('a.mp3'), song('b.mp3'), song('c.mp3')])
    await settle()
    dropUpload(uploads[1].id)
    FakeXHR.made[0].respond(201, { track: track('a') })
    await settle()
    expect((FakeXHR.made[1].body as File).name).toBe('c.mp3')
  })
})

describe('importing a link during a batch', () => {
  it('goes at once, not behind the files', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ track: track('link') }), { status: 201 }))
    globalThis.fetch = fetchMock as typeof fetch
    enqueueUploads([song('a.mp3'), song('b.mp3')])
    await settle()

    const got = importTrack('https://example.com/song.mp3')
    expect(library.importing).toBe(true)
    expect(await got).toEqual(track('link'))
    expect(fetchMock.mock.calls[0][0]).toBe('/music/tracks/import')
    expect(library.importing).toBe(false)
    expect(library.tracks.map(t => t.id)).toContain('link')
    // The batch carries on untouched.
    expect(FakeXHR.made).toHaveLength(1)
    expect(uploads.map(u => u.state)).toEqual(['uploading', 'waiting'])
  })

  it('a 429 says the limiter’s words and keeps nothing', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Too many uploads — wait a moment', code: 'RATE_LIMITED' }), { status: 429 })) as typeof fetch
    expect(await importTrack('https://example.com/song.mp3')).toBeNull()
    expect(library.error).toBe('Too many uploads — wait a moment')
    expect(library.importing).toBe(false)
  })
})
