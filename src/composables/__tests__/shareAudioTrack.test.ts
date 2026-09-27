import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startShareAudioTrack, stopShareAudioTrack } from '../shareAudioTrack'

const track = { kind: 'audio', id: 't1', stop: vi.fn() }

class FakeCtx {
  static added: string[] = []
  sampleRate = 48000
  state = 'running'
  audioWorklet = { addModule: vi.fn(async (u: string) => { FakeCtx.added.push(u) }) }
  close = vi.fn(async () => { this.state = 'closed' })
  createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [track] } })
}
const node = { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn(), close: vi.fn() } }

const port = () => ({ onmessage: null as ((e: MessageEvent) => void) | null, start: vi.fn(), close: vi.fn() })
const ctx = () => new FakeCtx() as unknown as AudioContext

beforeEach(async () => {
  await stopShareAudioTrack()
  FakeCtx.added = []
  vi.clearAllMocks()
  // A real constructor: `new` on an arrow function throws.
  ;(globalThis as Record<string, unknown>).AudioWorkletNode = function () { return node }
})

describe('startShareAudioTrack', () => {
  it('loads the worklet from its stable public path', async () => {
    await startShareAudioTrack(port() as unknown as MessagePort, ctx)
    expect(FakeCtx.added).toEqual(['/share-audio-worklet.js'])
  })

  it('returns the destination track', async () => {
    expect(await startShareAudioTrack(port() as unknown as MessagePort, ctx)).toBe(track)
  })

  it('transfers each chunk to the worklet rather than copying it', async () => {
    const p = port()
    await startShareAudioTrack(p as unknown as MessagePort, ctx)
    const chunk = new Float32Array(960)
    p.onmessage!({ data: chunk } as MessageEvent)
    expect(node.port.postMessage).toHaveBeenCalledWith(chunk, [chunk.buffer])
  })

  it('ignores anything on the port that is not audio', async () => {
    const p = port()
    await startShareAudioTrack(p as unknown as MessagePort, ctx)
    for (const bad of [null, 'x', 42, {}]) p.onmessage!({ data: bad } as MessageEvent)
    expect(node.port.postMessage).not.toHaveBeenCalled()
  })

  it('refuses a second start while one is running', async () => {
    await startShareAudioTrack(port() as unknown as MessagePort, ctx)
    expect(await startShareAudioTrack(port() as unknown as MessagePort, ctx)).toBeNull()
  })

  it('returns null and closes the port when the worklet will not load', async () => {
    const p = port()
    const broken = () => {
      const c = new FakeCtx()
      c.audioWorklet.addModule = vi.fn(async () => { throw new Error('nope') })
      return c as unknown as AudioContext
    }
    expect(await startShareAudioTrack(p as unknown as MessagePort, broken)).toBeNull()
    expect(p.close).toHaveBeenCalled()
  })

  it('leaves nothing running after a failed start, so the next one may begin', async () => {
    const broken = () => {
      const c = new FakeCtx()
      c.audioWorklet.addModule = vi.fn(async () => { throw new Error('nope') })
      return c as unknown as AudioContext
    }
    await startShareAudioTrack(port() as unknown as MessagePort, broken)
    expect(await startShareAudioTrack(port() as unknown as MessagePort, ctx)).toBe(track)
  })
})

describe('stopShareAudioTrack', () => {
  it('stops the track, closes the port and the context', async () => {
    const p = port()
    const c = new FakeCtx()
    await startShareAudioTrack(p as unknown as MessagePort, () => c as unknown as AudioContext)
    await stopShareAudioTrack()
    expect(track.stop).toHaveBeenCalled()
    expect(p.close).toHaveBeenCalled()
    expect(c.close).toHaveBeenCalled()
  })

  it('is safe to call when nothing is running', async () => {
    await expect(stopShareAudioTrack()).resolves.toBeUndefined()
  })
})
