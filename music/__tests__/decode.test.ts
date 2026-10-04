/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import {
  ffmpegArgs, frames, decode, startOffset, MAX_START_SEC,
  BYTES_PER_FRAME, SAMPLES_PER_FRAME, SAMPLE_RATE, CHANNELS,
} from '../src/decode.js'

describe('the argument vector', () => {
  it('reads the body from a pipe, never a URL or a path', () => {
    // The security property of phase 1: nothing a member typed reaches
    // ffmpeg's argv, so there is no argument-injection class to defend
    // against. If this ever stops being true the comment at the top of
    // decode.ts is a lie.
    const a = ffmpegArgs()
    expect(a).toContain('pipe:0')
    expect(a).toContain('pipe:1')
    for (const arg of a) {
      expect(arg).not.toMatch(/^https?:/)
      expect(arg).not.toMatch(/[\\/]/)      // no path separators at all
    }
  })

  it('is entirely constant', () => {
    expect(ffmpegArgs()).toEqual(ffmpegArgs())
  })

  it('asks for exactly the format LiveKit takes', () => {
    const a = ffmpegArgs()
    expect(a[a.indexOf('-f') + 1]).toBe('s16le')
    expect(a[a.indexOf('-ar') + 1]).toBe(String(SAMPLE_RATE))
    expect(a[a.indexOf('-ac') + 1]).toBe(String(CHANNELS))
  })

  it('drops video, because an mp3 can carry cover art', () => {
    expect(ffmpegArgs()).toContain('-vn')
  })
})

describe('starting part-way in', () => {
  it('adds no offset at the start', () => {
    expect(ffmpegArgs()).not.toContain('-ss')
    expect(ffmpegArgs(0)).toEqual(ffmpegArgs())
  })

  it('puts the offset after the input, so a pipe can be sought by decoding', () => {
    // Before -i, ffmpeg tries to seek the INPUT, and a pipe cannot be
    // sought. After it, ffmpeg decodes and throws away up to the offset.
    const a = ffmpegArgs(83)
    expect(a[a.indexOf('-ss') + 1]).toBe('83')
    expect(a.indexOf('-ss')).toBeGreaterThan(a.indexOf('-i'))
  })

  it('never lets anything but a whole number of seconds into argv', () => {
    for (const bad of [12.5, -3, MAX_START_SEC + 1, '5; rm -rf /', '30', NaN, Infinity, null, {}]) {
      expect(ffmpegArgs(bad as never)).not.toContain('-ss')
      expect(startOffset(bad)).toBe(0)
    }
    expect(startOffset(MAX_START_SEC)).toBe(MAX_START_SEC)
    expect(startOffset(1)).toBe(1)
  })
})

describe('frame sizing', () => {
  it('is 20ms of 48kHz stereo', () => {
    expect(SAMPLES_PER_FRAME).toBe(960)
    expect(BYTES_PER_FRAME).toBe(960 * 2 * 2)
  })
})

/** n frames' worth of bytes, each byte distinct enough to spot a mix-up. */
const pcm = (frameCount: number) => {
  const b = Buffer.alloc(BYTES_PER_FRAME * frameCount)
  for (let i = 0; i < b.length; i++) b[i] = i % 251
  return b
}

describe('frames()', () => {
  it('cuts a stream into whole frames', async () => {
    const out: Int16Array[] = []
    for await (const f of frames(Readable.from([pcm(3)]))) out.push(f)
    expect(out).toHaveLength(3)
    expect(out[0].length).toBe(SAMPLES_PER_FRAME * CHANNELS)
  })

  it('joins chunks that do not land on a frame boundary', async () => {
    // The realistic case: a socket hands over whatever size it likes.
    const whole = pcm(2)
    const a = whole.subarray(0, 100)
    const b = whole.subarray(100, BYTES_PER_FRAME + 7)
    const c = whole.subarray(BYTES_PER_FRAME + 7)
    const out: Int16Array[] = []
    for await (const f of frames(Readable.from([a, b, c]))) out.push(f)
    expect(out).toHaveLength(2)
  })

  it('holds back a partial frame rather than emitting a short one', async () => {
    // A short frame played as a whole one is a click.
    const out: Int16Array[] = []
    for await (const f of frames(Readable.from([pcm(1).subarray(0, BYTES_PER_FRAME - 2)]))) out.push(f)
    expect(out).toHaveLength(0)
  })

  it('emits nothing for an empty stream', async () => {
    const out: Int16Array[] = []
    for await (const f of frames(Readable.from([]))) out.push(f)
    expect(out).toHaveLength(0)
  })

  it('copies each frame, so a later chunk cannot rewrite one already handed over', async () => {
    // subarray shares memory with the buffer the next concat reuses. Without
    // the copy the consumer's first frame changes under it, which is the
    // kind of bug that sounds like random corruption and reproduces never.
    const whole = pcm(2)
    const out: Int16Array[] = []
    for await (const f of frames(Readable.from([whole.subarray(0, BYTES_PER_FRAME), whole.subarray(BYTES_PER_FRAME)]))) {
      out.push(f)
    }
    expect(out).toHaveLength(2)
    const first = Buffer.from(out[0].buffer)
    expect(first.equals(Buffer.from(whole.subarray(0, BYTES_PER_FRAME)))).toBe(true)
  })
})

describe('decode() against the real ffmpeg', () => {
  it('turns a generated tone into PCM frames', async () => {
    // Not a fixture: ffmpeg generates the input itself, so the test needs no
    // binary checked into the repo and still exercises the real decoder.
    const { spawn } = await import('child_process')
    const src = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
      '-f', 'mp3', 'pipe:1',
    ], { windowsHide: true })

    const errors: string[] = []
    const d = decode(src.stdout, { onStderr: l => errors.push(l) })

    let n = 0
    for await (const f of frames(d.pcm)) { expect(f.length).toBe(SAMPLES_PER_FRAME * CHANNELS); n++ }
    await d.done

    // Half a second at 20ms a frame is about 25; allow for the encoder's
    // own padding rather than pinning an exact count.
    expect(n).toBeGreaterThan(15)
    expect(errors.join(' ')).not.toMatch(/Invalid|error/i)
  }, 30_000)

  it('really starts late: three seconds from two in is one second of sound', async () => {
    // Opus in WebM over a pipe: the format the library stores, arriving the
    // way the service reads it. No cues to seek by, which is the point.
    const { spawn } = await import('child_process')
    const src = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
    ], { windowsHide: true })

    const d = decode(src.stdout, { startSec: 2 })
    let n = 0
    for await (const _ of frames(d.pcm)) n++
    await d.done
    // 50 frames a second. A few either side for the codec's pre-skip and
    // the last partial frame, but nowhere near the 150 of the whole thing.
    expect(n).toBeGreaterThanOrEqual(45)
    expect(n).toBeLessThanOrEqual(55)
  }, 30_000)

  it('stop() is safe to call twice and ends the decoder', async () => {
    const quiet = Readable.from([Buffer.alloc(0)])
    const d = decode(quiet)
    d.stop()
    d.stop()
    await expect(d.done).resolves.toBeDefined()
  }, 20_000)
})
