import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'

// The worklet is a classic script for the audio thread: no exports, and its
// globals do not exist in node. Evaluating the real file against stubs is
// what makes the shipped artifact testable rather than a copy of it.
let Processor: new () => {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown, outputs: Float32Array[][]): boolean
}

beforeAll(() => {
  const src = readFileSync(new URL('../../../public/share-audio-worklet.js', import.meta.url), 'utf8')
  let registered: unknown
  const scope = {
    AudioWorkletProcessor: class { port = { onmessage: null } },
    registerProcessor: (_name: string, cls: unknown) => { registered = cls },
    sampleRate: 48000,
  }
  new Function(...Object.keys(scope), src)(...Object.values(scope))
  Processor = registered as typeof Processor
})

const block = () => [new Float32Array(128), new Float32Array(128)]
const chunk = (value: number) => Float32Array.from({ length: 960 }, () => value)

describe('the share-audio worklet', () => {
  it('renders silence before anything arrives', () => {
    const p = new Processor()
    const out = block()
    expect(p.process([], [out])).toBe(true)
    expect(Array.from(out[0])).toEqual(new Array(128).fill(0))
  })

  it('de-interleaves a chunk across the two channels', () => {
    const p = new Processor()
    // Left 0.5, right -0.5, interleaved.
    const c = new Float32Array(960)
    for (let i = 0; i < 480; i++) { c[i * 2] = 0.5; c[i * 2 + 1] = -0.5 }
    p.port.onmessage!({ data: c })
    const out = block()
    p.process([], [out])
    expect(out[0][0]).toBeCloseTo(0.5)
    expect(out[1][0]).toBeCloseTo(-0.5)
  })

  it('keeps rendering across several blocks until the chunk runs out', () => {
    const p = new Processor()
    p.port.onmessage!({ data: chunk(0.25) })
    // 480 frames is 3.75 blocks of 128.
    for (let i = 0; i < 3; i++) {
      const out = block()
      p.process([], [out])
      expect(out[0][127]).toBeCloseTo(0.25)
    }
  })

  it('writes silence when it underruns rather than repeating the last block', () => {
    const p = new Processor()
    p.port.onmessage!({ data: chunk(0.25) })
    for (let i = 0; i < 4; i++) p.process([], [block()])
    const out = block()
    p.process([], [out])
    expect(Array.from(out[0])).toEqual(new Array(128).fill(0))
  })

  it('drops the oldest chunk when more than six are queued', () => {
    const p = new Processor()
    // Seven chunks, each a different value. The first must be gone.
    for (let i = 1; i <= 7; i++) p.port.onmessage!({ data: chunk(i / 10) })
    const out = block()
    p.process([], [out])
    expect(out[0][0]).toBeCloseTo(0.2)
  })

  it('ignores a message that is not audio', () => {
    const p = new Processor()
    for (const bad of [null, undefined, 'x', 42, {}]) p.port.onmessage!({ data: bad })
    const out = block()
    expect(p.process([], [out])).toBe(true)
    expect(out[0][0]).toBe(0)
  })

  it('never ends the node: a quiet share must still be able to speak later', () => {
    const p = new Processor()
    for (let i = 0; i < 50; i++) expect(p.process([], [block()])).toBe(true)
  })

  it('mixes down rather than dropping a side when the output is mono', () => {
    const p = new Processor()
    const c = new Float32Array(960)
    for (let i = 0; i < 480; i++) { c[i * 2] = 0.5; c[i * 2 + 1] = 0.1 }
    p.port.onmessage!({ data: c })
    const mono = [new Float32Array(128)]
    expect(p.process([], [mono])).toBe(true)
    expect(mono[0][0]).toBeCloseTo(0.3)
  })
})
