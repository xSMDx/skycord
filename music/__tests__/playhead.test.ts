/// <reference types="node" />
/**
 * Pausing a song the service is playing, without LiveKit.
 *
 * The publisher feeds frames to a LiveKit AudioSource, which needs a media
 * server to observe. Everything that decides WHICH frame goes next — the
 * hold, the take-back of what the source had queued, the reopen after a
 * source dies during a long pause — lives in playhead.ts against a plain
 * sink, so it is proven here frame by frame. Each test frame carries its own
 * index in its first sample, so order, gaps and repeats are all visible.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough, Readable, Transform } from 'stream'
import { BYTES_PER_FRAME } from '../src/decode.js'
import type { Decoder } from '../src/decode.js'
import { Playhead, playThrough, FRAME_MS, MAX_HOLD_MS, type Sink } from '../src/playhead.js'

const FRAMES_PER_SEC = 1000 / FRAME_MS

/** `n` frames of PCM, the k-th carrying k (counted from `from`) in its first sample. */
const pcm = (n: number, from = 0): Buffer => {
  const b = Buffer.alloc(n * BYTES_PER_FRAME)
  for (let k = 0; k < n; k++) b.writeInt16LE(from + k, k * BYTES_PER_FRAME)
  return b
}

/**
 * Stands in for ffmpeg: the "file" is already PCM, so decoding is passing it
 * through, and starting `startSec` in is dropping that many seconds of it.
 * stop() ends the output the way a killed ffmpeg's stdout ends, and a body
 * that closes without ending ends it after what was already read, the way
 * decode() ends ffmpeg's stdin and lets it finish (decode.test.ts proves
 * that half against the real ffmpeg).
 */
const decodes: number[] = []
const fakeDecode = (body: Readable, startSec: number): Decoder => {
  decodes.push(startSec)
  let skip = startSec * FRAMES_PER_SEC * BYTES_PER_FRAME
  const out = new Transform({
    transform(chunk: Buffer, _e, done) {
      if (skip >= chunk.length) { skip -= chunk.length; return done() }
      const rest = chunk.subarray(skip); skip = 0
      done(null, rest)
    },
  })
  body.pipe(out)
  let ended = false
  body.once('end', () => { ended = true })
  body.once('close', () => { if (!ended && !out.writableEnded) out.end() })
  let stopped = false
  return {
    pcm: out,
    stop: () => { if (stopped) return; stopped = true; body.unpipe(out); if (!out.writableEnded) out.end() },
    done: Promise.resolve(0),
  }
}

/** A sink that records each frame's index and can act as a frame goes in. */
const recorder = (opts: { queuedMs?: () => number; onFrame?: (index: number, count: number) => void } = {}) => {
  const seen: number[] = []
  let clears = 0
  const sink: Sink = {
    capture: async (f) => { seen.push(f[0]); opts.onFrame?.(f[0], seen.length) },
    queuedMs: () => opts.queuedMs?.() ?? 0,
    clear: () => { clears++ },
  }
  return { sink, seen, clears: () => clears }
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)
const tick = () => new Promise(r => setTimeout(r, 30))

describe('playing through', () => {
  it('sends every frame in order and reports the end', async () => {
    const rec = recorder()
    const head = new Playhead(0, rec.sink)
    const how = await playThrough({ head, body: Readable.from([pcm(10)]), startSec: 0, decode: fakeDecode })
    expect(how).toBe('ended')
    expect(rec.seen).toEqual(range(0, 10))
    expect(head.positionMs).toBe(10 * FRAME_MS)
  })

  it('is over once its last frame is out, while the decoder is still winding down', async () => {
    // ffmpeg takes a moment to exit after its last frame. A pause landing in
    // that moment must find nothing to hold: holding a finished song would
    // leave the room paused on it, with no end ever reported.
    let finish = () => {}
    const slow = (body: Readable, at: number): Decoder => ({
      ...fakeDecode(body, at),
      done: new Promise<number>(r => { finish = () => r(0) }),
    })
    const rec = recorder()
    const head = new Playhead(0, rec.sink)
    const done = playThrough({ head, body: Readable.from([pcm(3)]), startSec: 0, decode: slow })
    await tick()
    expect(rec.seen).toEqual([0, 1, 2])
    expect(head.stopped).toBe(true)
    finish()
    expect(await done).toBe('ended')
  })

  it('counts its position from where it started', () => {
    const head = new Playhead(42_000, recorder().sink)
    expect(head.positionMs).toBe(42_000)
  })
})

describe('a pause', () => {
  it('holds the next frame back until resume, and loses none', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 3) head.pause() } })
    head = new Playhead(0, rec.sink)
    const done = playThrough({ head, body: Readable.from([pcm(10)]), startSec: 0, decode: fakeDecode })
    await tick()
    expect(head.paused).toBe(true)
    expect(rec.seen).toEqual([0, 1, 2])
    await tick()
    expect(rec.seen).toEqual([0, 1, 2])          // held: nothing more goes out
    head.resume()
    expect(await done).toBe('ended')
    expect(rec.seen).toEqual(range(0, 10))
  })

  it('takes back what the source had queued but nobody heard, and sends it first on resume', async () => {
    // The AudioSource buffers up to a second ahead. A pause that left that
    // second to play out would be a pause that does not stop, and resuming
    // after it would skip the second nobody heard.
    let head!: Playhead
    const rec = recorder({
      queuedMs: () => 2 * FRAME_MS,
      onFrame: (_i, n) => { if (n === 5) head.pause() },
    })
    head = new Playhead(0, rec.sink)
    const done = playThrough({ head, body: Readable.from([pcm(10)]), startSec: 0, decode: fakeDecode })
    await tick()
    expect(rec.clears()).toBeGreaterThanOrEqual(1)
    // Five went out, two of them never played: the listener is at frame 3.
    expect(head.positionMs).toBe(3 * FRAME_MS)
    head.resume()
    expect(await done).toBe('ended')
    expect(rec.seen).toEqual([0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 9])
    expect(head.positionMs).toBe(10 * FRAME_MS)
  })

  it('pausing twice is one pause, and resuming a playing song does nothing', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 2) { head.pause(); head.pause() } } })
    head = new Playhead(0, rec.sink)
    head.resume()
    const done = playThrough({ head, body: Readable.from([pcm(6)]), startSec: 0, decode: fakeDecode })
    await tick()
    expect(rec.seen).toEqual([0, 1])
    head.resume()
    expect(await done).toBe('ended')
    expect(rec.seen).toEqual(range(0, 6))
  })

  it('a stop lets a held song go, reported as replaced so no end is sent', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 2) head.pause() } })
    head = new Playhead(0, rec.sink)
    const done = playThrough({ head, body: Readable.from([pcm(10)]), startSec: 0, decode: fakeDecode })
    await tick()
    head.stop()
    expect(await done).toBe('replaced')
    expect(rec.seen).toEqual([0, 1])
  })
})

describe('a source that dies during a long pause', () => {
  // The fetch under a held song stalls while it is held, and the far end
  // gives up on it: ten seconds for a pasted link's socket, five minutes
  // for the API's own. Carrying on from what was buffered would end the
  // song early and skip it, so it is fetched again and decoded from the
  // held point instead.
  const SONG = 300                                   // six seconds of frames

  it('is opened again at the held point, with no gap and no repeat', async () => {
    decodes.length = 0
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 60) head.pause() } })
    head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(70))                             // never ended: it dies instead
    let reopened = 0
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => { reopened++; return Readable.from([pcm(SONG)]) },
    })
    await tick()
    expect(head.paused).toBe(true)
    first.destroy()                                  // the far end gave up
    await tick()
    head.resume()
    expect(await done).toBe('ended')
    expect(reopened).toBe(1)
    // 60 frames is 1.2 s: decoded again from whole second 1, the rest dropped.
    expect(decodes).toEqual([0, 1])
    expect(rec.seen).toEqual(range(0, SONG))
    expect(head.positionMs).toBe(SONG * FRAME_MS)
  })

  it('fails, rather than going silent, when it cannot be fetched again', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 5) head.pause() } })
    head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(20))
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => null,
    })
    await tick()
    first.destroy()
    await tick()
    head.resume()
    expect(await done).toBe('failed')
  })

  it('is fetched again when it dies just after resume, while playing', async () => {
    // A pasted link's idle timer can fire a moment AFTER resume: the socket
    // is not read again until ffmpeg drains what it buffered. A close while
    // playing is as lost as one while held, or the song hangs silent.
    decodes.length = 0
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 60) head.pause() } })
    head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(70))
    let reopened = 0
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => { reopened++; return Readable.from([pcm(SONG)]) },
    })
    await tick()
    head.resume()
    first.destroy()                                  // right after resume
    expect(await done).toBe('ended')
    expect(reopened).toBe(1)
    expect(rec.seen).toEqual(range(0, SONG))
  })

  it('gives up, rather than fetching forever, on a source that dies before sending anything', async () => {
    let head!: Playhead
    const rec = recorder()
    head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(10))
    setTimeout(() => first.destroy(), 20)
    let reopened = 0
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => {
        reopened++
        const dead = new PassThrough()
        setTimeout(() => dead.destroy(), 5)
        return dead
      },
    })
    expect(await done).toBe('failed')
    expect(reopened).toBe(1)
    expect(rec.seen).toEqual(range(0, 10))
  })

  it('a pause during the refetch loses nothing, even across a second boundary', async () => {
    // The pause takes back two unheard frames, moving the listener from just
    // past second 1 to just before it. The fresh decode has to start from
    // where the listener is AFTER that, or the taken-back frames are lost.
    decodes.length = 0
    const rec = recorder({ queuedMs: () => 2 * FRAME_MS })
    const head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(51))                             // 1.02 s
    setTimeout(() => first.destroy(), 20)
    let release: (b: Readable) => void = () => {}
    let asked = false
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: () => { asked = true; return new Promise<Readable>(r => { release = r }) },
    })
    for (let i = 0; i < 50 && !asked; i++) await tick()
    expect(asked).toBe(true)
    head.pause()
    expect(head.positionMs).toBe(49 * FRAME_MS)
    release(Readable.from([pcm(SONG)]))
    await tick()
    head.resume()
    expect(await done).toBe('ended')
    expect(decodes).toEqual([0, 0])
    expect(rec.seen).toEqual([...range(0, 51), ...range(49, SONG)])
  })

  it('keeps the take-back across a refetch: a pause just after it still loses nothing', async () => {
    // The source still holds frames sent BEFORE the refetch. A pause on the
    // first fresh frame must take those back too, not only what came after.
    let head!: Playhead
    const first = new PassThrough()
    const rec = recorder({
      queuedMs: () => 3 * FRAME_MS,
      onFrame: (_i, n) => {
        if (n === 60) setImmediate(() => first.destroy())   // drops while playing
        if (n === 61) head.pause()                           // the first fresh frame
      },
    })
    head = new Playhead(0, rec.sink)
    first.write(pcm(60))
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => Readable.from([pcm(SONG)]),
    })
    for (let i = 0; i < 50 && !head.paused; i++) await tick()
    expect(head.paused).toBe(true)
    expect(head.positionMs).toBe(58 * FRAME_MS)
    head.resume()
    expect(await done).toBe('ended')
    expect(rec.seen).toEqual([...range(0, 61), ...range(58, SONG)])
  })

  it('stops fetching a source that keeps dropping while playing, after three refetches', async () => {
    // Each refetch downloads the song again up to where the listener is. A
    // source that drops every few seconds would do that for the whole song.
    const flaky = (frames: number) => {
      let i = 0
      return new Readable({
        highWaterMark: BYTES_PER_FRAME,
        read() { if (i < frames) this.push(pcm(1, i++)); else this.destroy() },
      })
    }
    const rec = recorder()
    const head = new Playhead(0, rec.sink)
    let reopened = 0
    const done = playThrough({
      head, body: flaky(50), startSec: 0, decode: fakeDecode,
      // Every copy gets fifty frames further before it drops, so each one is
      // progress — none trips the nothing-at-all guard.
      reopen: async () => { reopened++; return reopened > 6 ? null : flaky(50 * (reopened + 1)) },
    })
    expect(await done).toBe('failed')
    expect(reopened).toBe(3)
    expect(rec.seen).toEqual(range(0, rec.seen.length))   // in order, nothing repeated
    expect(rec.seen.length).toBeGreaterThan(150)
  })

  it('does not count refetches after a pause toward that limit', async () => {
    // Four pauses long enough to lose the source: each is the pause's doing.
    let head!: Playhead
    const rec = recorder()
    head = new Playhead(0, rec.sink)
    let body = new PassThrough()
    body.write(pcm(20))
    let reopened = 0
    const done = playThrough({
      head, body, startSec: 0, decode: fakeDecode,
      reopen: async () => {
        reopened++
        body = new PassThrough()
        body.write(pcm(20 * (reopened + 1)))
        if (reopened === 4) body.end()               // the last copy reaches the end
        return body
      },
    })
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 50 && rec.seen.length < 20 * (round + 1); i++) await tick()
      head.pause()
      body.destroy()
      await tick()
      head.resume()
    }
    expect(await done).toBe('ended')
    expect(reopened).toBe(4)
    expect(rec.seen).toEqual(range(0, 100))
  })

  it('is not mistaken for one when the song is stopped instead', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 5) head.pause() } })
    head = new Playhead(0, rec.sink)
    const first = new PassThrough()
    first.write(pcm(20))
    let reopened = 0
    const done = playThrough({
      head, body: first, startSec: 0, decode: fakeDecode,
      reopen: async () => { reopened++; return null },
    })
    await tick()
    head.stop()
    first.destroy()
    expect(await done).toBe('replaced')
    expect(reopened).toBe(0)
  })
})

describe('a hold nobody comes back for', () => {
  // Rooms live in the API's memory. An API restarted during a pause has
  // forgotten the room, so nobody can resume or close it, and the held
  // decoder and fetch would sit here forever. A hold is bounded: past
  // MAX_HOLD_MS the song is let go, reported as replaced so no end is sent.
  // A later /resume then gets a 409, and the API starts the song again from
  // where it froze.
  afterEach(() => { vi.useRealTimers() })
  /** Streams run on nextTick and setImmediate, which stay real. */
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }

  it('is a named, generous bound', () => {
    expect(MAX_HOLD_MS).toBe(30 * 60 * 1000)
  })

  it('lets the song go once the bound passes, reported as replaced, and releases the fetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let head!: Playhead
    let expired = 0
    const rec = recorder({ onFrame: (_i, n) => { if (n === 3) head.pause() } })
    head = new Playhead(0, rec.sink, { onHoldExpired: () => { expired++ } })
    const body = new PassThrough()
    body.write(pcm(20))                              // never ended: a live fetch
    let outcome: string | null = null
    void playThrough({ head, body, startSec: 0, decode: fakeDecode }).then(h => { outcome = h })
    await flush()
    expect(head.paused).toBe(true)

    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS - 1)
    await flush()
    expect(head.stopped).toBe(false)
    expect(outcome).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(head.stopped).toBe(true)
    expect(expired).toBe(1)
    expect(outcome).toBe('replaced')
    expect(body.destroyed).toBe(true)                // the fetch is not left open
    expect(rec.seen).toEqual([0, 1, 2])
    // Nothing left to resume: the service answers 409 and the API restarts it.
    head.resume()
    expect(head.paused).toBe(false)
  })

  it('starts counting again at each pause: a resume clears it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const head = new Playhead(0, recorder().sink)
    head.pause()
    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS - 1000)
    head.resume()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS)
    expect(head.stopped).toBe(false)

    head.pause()
    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS - 1)
    expect(head.stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(head.stopped).toBe(true)
  })

  it('is cleared by a stop (a skip, a close), so nothing fires later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let expired = 0
    const head = new Playhead(0, recorder().sink, { onHoldExpired: () => { expired++ } })
    head.pause()
    head.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS * 2)
    expect(expired).toBe(0)
  })

  it('takes a shorter bound when given one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const head = new Playhead(0, recorder().sink, { maxHoldMs: 1000 })
    head.pause()
    await vi.advanceTimersByTimeAsync(1000)
    expect(head.stopped).toBe(true)
  })
})

describe('a song that is over', () => {
  it('lets go of its fetch when stopped, rather than leaving the socket to idle out', async () => {
    let head!: Playhead
    const rec = recorder({ onFrame: (_i, n) => { if (n === 2) head.stop() } })
    head = new Playhead(0, rec.sink)
    const body = new PassThrough()
    body.write(pcm(20))
    expect(await playThrough({ head, body, startSec: 0, decode: fakeDecode })).toBe('replaced')
    expect(body.destroyed).toBe(true)
  })
})
