import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * User Volume above 100 % (spec 12).
 *
 * An <audio> element's volume stops at 1 and throws past it, so a voice
 * turned up to 150 % threw out of every volume change and every attach. The
 * fix is one pure decision, volumePlan, and one shared Web Audio gain stage
 * that a voice goes through only while it is turned up past what the
 * element can play.
 *
 * The stage plays the element's stream through createMediaStreamSource,
 * with the element left playing muted — the way livekit-client's own
 * webAudioMix does it, because Chromium plays a remote WebRTC stream into
 * Web Audio only while a media element also plays it. vitest runs in node,
 * so the stage is driven against a fake AudioContext that keeps the parts
 * this module touches.
 */

type G = typeof import('../remoteGain')

const support = (over: Partial<import('../remoteGain').GainSupport> = {}) =>
  ({ webAudio: true, contextSink: true, elementSink: true, ...over })

describe('volumePlan', () => {
  let G: G
  beforeEach(async () => { G = await import('../remoteGain') })

  it('≤100 % uses the element volume only', () => {
    expect(G.volumePlan(100, 100, true)).toEqual({ elVolume: 1, gain: 1, capped: false })
    expect(G.volumePlan(100, 40, true)).toEqual({ elVolume: 0.4, gain: 1, capped: false })
    expect(G.volumePlan(100, 0, true)).toEqual({ elVolume: 0, gain: 1, capped: false })
    // The output level multiplies it, so 50 % output × 150 % still fits in the element.
    expect(G.volumePlan(50, 150, true)).toEqual({ elVolume: 0.75, gain: 1, capped: false })
    expect(G.volumePlan(100, 100, false)).toEqual({ elVolume: 1, gain: 1, capped: false })
  })

  it('150 % with sink routing → elVolume 1, gain 1.5', () => {
    expect(G.volumePlan(100, 150, true)).toEqual({ elVolume: 1, gain: 1.5, capped: false })
    expect(G.volumePlan(100, 200, true)).toEqual({ elVolume: 1, gain: 2, capped: false })
    const p = G.volumePlan(80, 150, true)
    expect(p.elVolume).toBe(1)
    expect(p.gain).toBeCloseTo(1.2)
  })

  it('150 % without sink routing → elVolume 1, gain 1, and capped flag', () => {
    expect(G.volumePlan(100, 150, false)).toEqual({ elVolume: 1, gain: 1, capped: true })
    // Capped at the slider's top, 100 %: what is heard matches the slider.
    expect(G.volumePlan(50, 150, false)).toEqual({ elVolume: 0.5, gain: 1, capped: true })
  })

  it('never hands the element a volume it would throw on', () => {
    for (const [o, u, r] of [[100, 999, true], [100, -20, true], [140, 100, false], [NaN, NaN, true],
      [100, Infinity, true]] as const) {
      const p = G.volumePlan(o, u, r)
      expect(p.elVolume).toBeGreaterThanOrEqual(0)
      expect(p.elVolume).toBeLessThanOrEqual(1)
      expect(p.gain).toBeGreaterThanOrEqual(1)
      expect(p.gain).toBeLessThanOrEqual(2)
    }
  })
})

describe('sinkRoutable and userVolumeMaxFor', () => {
  let G: G
  beforeEach(async () => { G = await import('../remoteGain') })

  it('the default output always carries amplification — the phone app never picks one', () => {
    expect(G.sinkRoutable('', support({ contextSink: false }))).toBe(true)
    // "default" is the default device under another name.
    expect(G.sinkRoutable('default', support({ contextSink: false }))).toBe(true)
  })

  it('a chosen output needs AudioContext.setSinkId to keep it', () => {
    expect(G.sinkRoutable('speakers-2', support())).toBe(true)
    expect(G.sinkRoutable('speakers-2', support({ contextSink: false }))).toBe(false)
  })

  it('a browser whose elements cannot pick an output has none to lose', () => {
    expect(G.sinkRoutable('speakers-2', support({ contextSink: false, elementSink: false }))).toBe(true)
  })

  it('no Web Audio, no amplification', () => {
    expect(G.sinkRoutable('', support({ webAudio: false }))).toBe(false)
  })

  it('the slider tops out at 200 when amplification can reach the output, 100 when not', () => {
    expect(G.userVolumeMaxFor(true)).toBe(200)
    expect(G.userVolumeMaxFor(false)).toBe(100)
    expect(G.USER_VOLUME_MAX).toBe(200)
  })
})

// ── The stage, against a fake Web Audio ─────────────────────────────────────

interface FakeNode { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
interface FakeGain extends FakeNode {
  gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }
}

class FakeAudioContext {
  static made: FakeAudioContext[] = []
  static startAs: AudioContextState = 'running'
  state: AudioContextState = FakeAudioContext.startAs
  currentTime = 0
  destination = { kind: 'destination' }
  onstatechange: (() => void) | null = null
  sources: Array<FakeNode & { stream: unknown }> = []
  gains: FakeGain[] = []
  setSinkId = vi.fn(async (_id: string) => {})
  constructor() { FakeAudioContext.made.push(this) }
  private to(s: AudioContextState) { this.state = s; this.onstatechange?.() }
  // As the real one: `state` changes once the request settles, and requests
  // settle in the order they were made.
  resume = vi.fn(async () => { await null; this.to('running') })
  suspend = vi.fn(async () => { await null; this.to('suspended') })
  createMediaStreamSource = vi.fn((stream: unknown) => {
    const n = { stream, connect: vi.fn((x: unknown) => x), disconnect: vi.fn() }
    this.sources.push(n)
    return n
  })
  createGain = vi.fn(() => {
    const g: FakeGain = {
      gain: { value: 1, setTargetAtTime: vi.fn((v: number) => { g.gain.value = v }) },
      connect: vi.fn((x: unknown) => x), disconnect: vi.fn(),
    }
    this.gains.push(g)
    return g
  })
}

const audioTrack = (id: string) => ({ id, kind: 'audio' })
/** A livekit-attached <audio>: srcObject is a stream holding the remote track. */
const element = (track = audioTrack('t1')) => {
  let tracks = [track]
  return {
    muted: false, volume: 1,
    srcObject: { getAudioTracks: () => tracks },
    /** As livekit's attachToElement on a pooled element: same stream, new track. */
    swap(t: ReturnType<typeof audioTrack>) { tracks = [t] },
  }
}
const asEl = (e: ReturnType<typeof element>) => e as unknown as HTMLMediaElement

describe('the gain stage', () => {
  let G: G
  beforeEach(async () => {
    FakeAudioContext.made = []
    FakeAudioContext.startAs = 'running'
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.resetModules()
    G = await import('../remoteGain')
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('plays the element through one shared context: its stream → a gain → the speakers', () => {
    const a = element(), b = element(audioTrack('t2'))
    expect(G.amplify(asEl(a), 1.5, false, '')).toBe(true)
    expect(G.amplify(asEl(b), 1.8, false, '')).toBe(true)

    expect(FakeAudioContext.made).toHaveLength(1)
    const ctx = FakeAudioContext.made[0]
    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(a.srcObject)
    const [src] = ctx.sources, [gain] = ctx.gains
    expect(src.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination)
    expect(gain.gain.value).toBe(1.5)
    expect(ctx.gains[1].gain.value).toBe(1.8)
    // Still playing — Chromium needs it to — but heard through the stage only.
    expect(a.muted).toBe(true)
    expect(G.stageGain(asEl(a))).toBe(1.5)
  })

  it('a second call for the same element and track moves its gain, and builds nothing new', () => {
    const a = element()
    G.amplify(asEl(a), 1.5, false, '')
    G.amplify(asEl(a), 1.9, false, '')
    const ctx = FakeAudioContext.made[0]
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(1)
    expect(ctx.gains[0].gain.setTargetAtTime).toHaveBeenCalledWith(1.9, expect.any(Number), expect.any(Number))
    expect(G.stageGain(asEl(a))).toBe(1.9)
  })

  it('muted is a gain of 0 — the element is already silent while it is routed', () => {
    const a = element()
    G.amplify(asEl(a), 1.5, true, '')
    expect(G.stageGain(asEl(a))).toBe(0)
    G.amplify(asEl(a), 1.5, false, '')
    expect(G.stageGain(asEl(a))).toBe(1.5)
  })

  it('an element livekit reused from its pool, now playing another track, gets a fresh source', () => {
    const a = element()
    G.amplify(asEl(a), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]
    const [oldSrc] = ctx.sources, [oldGain] = ctx.gains

    a.swap(audioTrack('t9'))
    expect(G.amplify(asEl(a), 1.5, false, '')).toBe(true)

    expect(oldSrc.disconnect).toHaveBeenCalled()
    expect(oldGain.disconnect).toHaveBeenCalled()
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2)
  })

  it('release disconnects the stage and forgets it; the next amplify builds from scratch', () => {
    const a = element()
    G.amplify(asEl(a), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]
    G.release(asEl(a))
    expect(ctx.sources[0].disconnect).toHaveBeenCalled()
    expect(ctx.gains[0].disconnect).toHaveBeenCalled()
    expect(G.stageGain(asEl(a))).toBeNull()
    G.release(asEl(a))   // twice is harmless

    G.amplify(asEl(a), 1.5, false, '')
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2)
  })

  it('a suspended context is asked to resume, and until it runs the element plays on its own', async () => {
    FakeAudioContext.startAs = 'suspended'
    const changed = vi.fn()
    G.onGainStateChange(changed)
    const a = element()

    expect(G.amplify(asEl(a), 1.5, false, '')).toBe(false)
    const ctx = FakeAudioContext.made[0]
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.createMediaStreamSource).not.toHaveBeenCalled()
    // Not muted: never silent because the context is.
    expect(a.muted).toBe(false)

    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(G.amplify(asEl(a), 1.5, false, '')).toBe(true)
  })

  it('a context that stops mid-call tells the caller, so it can fall back to the element', () => {
    const changed = vi.fn()
    G.onGainStateChange(changed)
    G.amplify(asEl(element()), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]

    ctx.state = 'suspended'; ctx.onstatechange?.()
    expect(changed).toHaveBeenCalled()
    expect(G.amplify(asEl(element()), 1.5, false, '')).toBe(false)
  })

  it('points the context at the chosen output, once per change; "default" is the default', () => {
    const a = element()
    G.amplify(asEl(a), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]
    expect(ctx.setSinkId).not.toHaveBeenCalled()

    G.amplify(asEl(a), 1.5, false, 'speakers-2')
    G.amplify(asEl(a), 1.6, false, 'speakers-2')
    expect(ctx.setSinkId.mock.calls).toEqual([['speakers-2']])

    // AudioContext.setSinkId does not take "default"; "" is the default device.
    G.amplify(asEl(a), 1.6, false, 'default')
    expect(ctx.setSinkId.mock.calls).toEqual([['speakers-2'], ['']])
  })

  it('the first amplification on a chosen output waits until the context is pointed there', async () => {
    // Connected at once, the voice would play on the default device until
    // setSinkId settled — the wrong speakers, at 150 %.
    const changed = vi.fn()
    G.onGainStateChange(changed)
    let settle!: () => void
    const a = element()
    G.amplify(asEl(element(audioTrack('t0'))), 1.2, false, '')
    const ctx = FakeAudioContext.made[0]
    ctx.setSinkId.mockImplementationOnce(() => new Promise<void>(r => { settle = r }))

    expect(G.amplify(asEl(a), 1.5, false, 'speakers-2')).toBe(false)
    expect(G.amplify(asEl(a), 1.5, false, 'speakers-2')).toBe(false)
    expect(ctx.setSinkId.mock.calls).toEqual([['speakers-2']])
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(1)
    // Left on its element meanwhile, never silent.
    expect(a.muted).toBe(false)

    settle()
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(G.amplify(asEl(a), 1.5, false, 'speakers-2')).toBe(true)
    expect(ctx.gains.at(-1)!.connect).toHaveBeenCalledWith(ctx.destination)
    expect(ctx.setSinkId).toHaveBeenCalledTimes(1)
  })

  it('a chosen output the context refuses is remembered, and the caller is told to apply again', async () => {
    const changed = vi.fn()
    G.onGainStateChange(changed)
    G.amplify(asEl(element()), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]
    ctx.setSinkId.mockImplementationOnce(async () => { throw new Error('NotFoundError') })

    expect(G.sinkRefused('speakers-2')).toBe(false)
    expect(G.amplify(asEl(element(audioTrack('t2'))), 1.5, false, 'speakers-2')).toBe(false)
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(G.sinkRefused('speakers-2')).toBe(true)
    expect(G.sinkRefused('')).toBe(false)
    expect(G.sinkRefused('default')).toBe(false)
    // Not asked again while it is still the choice.
    expect(G.amplify(asEl(element(audioTrack('t3'))), 1.5, false, 'speakers-2')).toBe(false)
    expect(ctx.setSinkId).toHaveBeenCalledTimes(1)

    // Choosing something else forgets it, so choosing it again tries again.
    G.amplify(asEl(element(audioTrack('t4'))), 1.5, false, '')
    expect(G.sinkRefused('speakers-2')).toBe(false)
  })

  it('a context without setSinkId plays to the default device rather than failing', () => {
    const noSink = class extends FakeAudioContext { constructor() { super(); (this as any).setSinkId = undefined } }
    vi.stubGlobal('AudioContext', noSink)
    expect(G.amplify(asEl(element()), 1.5, false, 'speakers-2')).toBe(true)
  })

  it('declines, leaving the element alone, when there is nothing to route', () => {
    const bare = { muted: false, volume: 1, srcObject: null }
    expect(G.amplify(bare as unknown as HTMLMediaElement, 1.5, false, '')).toBe(false)
    expect(bare.muted).toBe(false)

    const ctx = (G.amplify(asEl(element()), 1.5, false, ''), FakeAudioContext.made[0])
    ctx.createMediaStreamSource.mockImplementationOnce(() => { throw new Error('InvalidStateError') })
    const e = element(audioTrack('t5'))
    expect(G.amplify(asEl(e), 1.5, false, '')).toBe(false)
    expect(e.muted).toBe(false)
  })

  it('no Web Audio at all: declines', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(G.amplify(asEl(element()), 1.5, false, '')).toBe(false)
  })

  it('wake resumes the shared context on a gesture path; sleep suspends it between calls', async () => {
    G.wakeGain()   // nothing made yet: nothing to wake, and nothing is created
    expect(FakeAudioContext.made).toHaveLength(0)

    G.amplify(asEl(element()), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]
    G.sleepGain()
    expect(ctx.suspend).toHaveBeenCalled()
    await vi.waitFor(() => expect(ctx.state).toBe('suspended'))

    G.wakeGain()
    expect(ctx.resume).toHaveBeenCalled()
    await vi.waitFor(() => expect(ctx.state).toBe('running'))
  })

  it('sleep then wake at once — leaving one call for another — ends running', async () => {
    G.amplify(asEl(element()), 1.5, false, '')
    const ctx = FakeAudioContext.made[0]

    G.sleepGain()
    // Still "running" here: the suspend has not settled. A wake that trusted
    // `state` would skip the resume and leave the stage asleep.
    expect(ctx.state).toBe('running')
    G.wakeGain()

    await vi.waitFor(() => expect(ctx.suspend).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(ctx.state).toBe('running')
  })

  it('gainSupport reads the browser', () => {
    vi.stubGlobal('HTMLMediaElement', class { setSinkId() {} })
    expect(G.gainSupport()).toEqual({ webAudio: true, contextSink: false, elementSink: true })
    FakeAudioContext.prototype.setSinkId = (() => {}) as never
    try {
      expect(G.gainSupport().contextSink).toBe(true)
    } finally { delete (FakeAudioContext.prototype as { setSinkId?: unknown }).setSinkId }
  })
})
