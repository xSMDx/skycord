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
import { describe, it, expect } from 'vitest'
import { PassThrough, Readable, Transform } from 'stream'
import { BYTES_PER_FRAME } from '../src/decode.js'
import type { Decoder } from '../src/decode.js'
import { Playhead, playThrough, FRAME_MS, type Sink } from '../src/playhead.js'

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
 * stop() ends the output the way a killed ffmpeg's stdout ends.
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
  let stopped = false
  return {
    pcm: out,
    stop: () => { if (stopped) return; stopped = true; body.unpipe(out); out.end() },
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
