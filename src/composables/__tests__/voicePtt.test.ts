/**
 * Hold to talk: the press and release behind the push-to-talk key and the
 * phone's "Hold to talk" bar, the one-time microphone ask a phone makes when it
 * joins a push-to-talk call, and the moment the call started.
 *
 * The key used to publish and swallow every error, which was fine while the
 * only caller was a keydown handler with nowhere to put an answer. The phone's
 * bar has to know whether the press worked: claiming "Talking…" over a refused
 * microphone is the lie `voice.mic` exists to prevent. So the press reports,
 * and a press that cannot transmit says why through the same `voice.mic` the
 * rest of the call already reads.
 *
 * The join half runs the real `attemptConnect` against a fake LiveKit room, so
 * what is pinned is the sequence a member actually goes through, not a helper
 * that happens to be next to it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest'

// Same three stubs, for the same reasons, as voiceRejoin.test.ts: useVoice.ts
// reaches the mic chain (RNNoise wasm/AudioWorklet), usePresence (localStorage
// at module load) and, through usePerformance, the Material You colour utilities.
vi.mock('../micChain', () => ({ createMicChainProcessor: () => ({}) }))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {}, holdPresence: () => {} }))
vi.mock('../materialScheme', () => ({ SCHEME_TOKEN_KEYS: [], buildSchemeTokens: () => ({}) }))

vi.mock('../useSocket', async () => {
  const { ref } = await import('vue')
  return {
    connected: ref(false),
    getSocket: () => ({ emit: () => {} }),
    emitCallJoin: () => {}, emitCallLeave: () => {}, emitCallRejoin: () => {},
    callServerMoved: ref(null),
    soundCallJoin: () => {}, soundCallLeave: () => {},
    soundUserJoin: () => {}, soundUserLeave: () => {},
    soundMute: () => {}, soundUnmute: () => {},
    soundDeafen: () => {}, soundUndeafen: () => {},
  }
})

// What the test steers: the token the server "hands out", whether the media
// server accepts the connection, and every room the code under test opened.
const h = vi.hoisted(() => ({
  getVoiceToken: vi.fn(),
  failConnect: false,
  rooms: [] as Array<{
    emit: (event: string, ...args: unknown[]) => void
    localParticipant: { setMicrophoneEnabled: ReturnType<typeof vi.fn> }
    disconnect: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('../useApi', () => ({
  useApi: () => ({ getVoiceToken: h.getVoiceToken, moveVoiceCall: vi.fn() }),
}))

// The real enums and `Track`, a fake `Room`: the connect path only needs a room
// that accepts a connection, records what is asked of its microphone, and can
// be told it dropped.
vi.mock('livekit-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('livekit-client')>()
  class FakeRoom {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    localParticipant = {
      identity: 'me', name: 'Me', isSpeaking: false, isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async () => undefined),
      getTrackPublication: () => undefined,
    }
    remoteParticipants = new Map()
    constructor() { h.rooms.push(this) }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
      return this
    }
    emit(event: string, ...args: unknown[]) { this.handlers.get(event)?.forEach(fn => fn(...args)) }
    connect = vi.fn(() => (h.failConnect ? Promise.reject(new Error('no route')) : Promise.resolve()))
    disconnect = vi.fn(async () => {})
  }
  return { ...real, Room: FakeRoom }
})

// Real viewport rules, driven by two refs the tests can flip: whether this is a
// small screen, and whether the pointer is a finger. noPushToTalkKey and
// effectiveInputMode stay the real code reading them.
vi.mock('../useViewport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../useViewport')>()
  const { ref } = await import('vue')
  const phone = { isMobile: ref(false), isCoarse: ref(false) }
  return {
    ...real,
    phone,
    useViewport: () => ({ ...real.useViewport(), isMobile: phone.isMobile, isCoarse: phone.isCoarse }),
  }
})

let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice
let pttPress: typeof import('../useVoice').pttPress
let pttRelease: typeof import('../useVoice').pttRelease
let setRoom: typeof import('../voiceRoom').setRoom
let setPermits: typeof import('../voicePermits').setPermits
let resetPermits: typeof import('../voicePermits').resetPermits
let phone: { isMobile: { value: boolean }; isCoarse: { value: boolean } }

beforeAll(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
  const inertEl = () => ({ style: {}, setAttribute() {}, removeAttribute() {} })
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
    addEventListener() {}, removeEventListener() {},
  } as unknown as Document
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia

  ;({ voice, useVoice, pttPress, pttRelease } = await import('../useVoice'))
  ;({ setRoom } = await import('../voiceRoom'))
  ;({ setPermits, resetPermits } = await import('../voicePermits'))
  ;({ phone } = await import('../useViewport') as unknown as { phone: typeof phone })
})

const refusal = (name: string) => Object.assign(new Error(name), { name })

type SetMic = (on: boolean, ...rest: unknown[]) => Promise<undefined>

/** A room that is only a microphone: enough for press and release, which touch nothing else. */
const micRoom = (setMicrophoneEnabled: Mock<SetMic> = vi.fn<SetMic>(async () => undefined)) => {
  const room = { localParticipant: { setMicrophoneEnabled } }
  setRoom(room as never)
  return setMicrophoneEnabled
}

describe('pttPress and pttRelease', () => {
  beforeEach(() => {
    voice.localDeafened = false
    voice.mic = 'muted'
    resetPermits()
  })
  afterEach(() => { setRoom(null) })

  it('pttPress publishes and resolves true', async () => {
    const setMic = micRoom()

    await expect(pttPress()).resolves.toBe(true)

    expect(setMic).toHaveBeenCalledTimes(1)
    expect(setMic.mock.calls[0][0]).toBe(true)
  })

  it('pttPress is false and publishes nothing while deafened', async () => {
    // Deafened means hearing nothing, and the key has always done nothing then.
    // The bar is disabled in the same state, but it must not rely on that.
    const setMic = micRoom()
    voice.localDeafened = true

    await expect(pttPress()).resolves.toBe(false)

    expect(setMic).not.toHaveBeenCalled()
  })

  it('pttPress is false while permits.audio is false', async () => {
    // Server-muted, or no Speak permission. The token would refuse the publish
    // anyway; refusing here is what stops the bar drawing "Talking…" first.
    const setMic = micRoom()
    setPermits({ audio: false })

    await expect(pttPress()).resolves.toBe(false)

    expect(setMic).not.toHaveBeenCalled()
  })

  it('pttPress is false with no room, rather than throwing', async () => {
    // Pressing after the call dropped, or before it connected.
    await expect(pttPress()).resolves.toBe(false)
  })

  it('a refused publish sets voice.mic to the failure reason and resolves false', async () => {
    micRoom(vi.fn<SetMic>(async () => { throw refusal('NotAllowedError') }))
    await expect(pttPress()).resolves.toBe(false)
    expect(voice.mic).toBe('denied')

    // The reason is the same classification the join and the mute button use,
    // so each cause keeps its own sentence in the call panel.
    micRoom(vi.fn<SetMic>(async () => { throw refusal('NotReadableError') }))
    await expect(pttPress()).resolves.toBe(false)
    expect(voice.mic).toBe('busy')
  })

  it('a publish that works afterwards clears the failure it had reported', async () => {
    // Without this a refusal the person has since fixed (allowed the microphone
    // in settings, closed the other app) would keep its notice for the whole
    // call, over a press that now works.
    micRoom(vi.fn<SetMic>(async () => { throw refusal('NotAllowedError') }))
    await pttPress()
    expect(voice.mic).toBe('denied')

    micRoom()
    await expect(pttPress()).resolves.toBe(true)

    expect(voice.mic).toBe('muted')
  })

  it('pttRelease turns the mic off and is safe to call twice or with no room', async () => {
    const setMic = micRoom()

    pttRelease()
    pttRelease()
    expect(setMic.mock.calls.map(c => c[0])).toEqual([false, false])

    // Later callers release from several places (pointerup, pointercancel, a
    // lost capture, the page hiding), so a release after the call is gone, or
    // for a microphone that refuses to switch off, must be a quiet no-op.
    micRoom(vi.fn<SetMic>(async () => { throw new Error('already gone') }))
    expect(() => pttRelease()).not.toThrow()
    setRoom(null)
    expect(() => pttRelease()).not.toThrow()
    await Promise.resolve()   // let the swallowed rejection settle: an unhandled one fails the run
  })

  it('a release that lands while the press is still publishing leaves the mic off', async () => {
    // The first press is the slow one: it can sit behind a permission prompt.
    // A tap shorter than that would otherwise release before there was
    // anything to release, and the publish landing afterwards would leave the
    // microphone open with nobody holding anything.
    let landPublish!: () => void
    const setMic = micRoom(vi.fn<SetMic>((on) =>
      on ? new Promise<undefined>(done => { landPublish = () => done(undefined) }) : Promise.resolve(undefined)))

    const pressed = pttPress()
    pttRelease()
    landPublish()

    await expect(pressed).resolves.toBe(false)
    expect(setMic.mock.calls.at(-1)?.[0]).toBe(false)
  })
})

// ── Joining ──────────────────────────────────────────────────────────────────

const tokenFor = (pttRequired: boolean) => ({
  token: 't', url: 'wss://sfu.test', voiceServer: null,
  voiceActivity: !pttRequired,
})

/** connect() hands the join to attemptConnect without waiting for it. */
const join = async (pttRequired: boolean, convId = 'c1') => {
  h.getVoiceToken.mockResolvedValue(tokenFor(pttRequired))
  await useVoice().connect(convId, 'channel', 'Lounge')
  await vi.waitFor(() => expect(voice.connected).toBe(true))
}

/** What a phone's browser hands back for an audio capture: a stream with tracks to stop. */
const captureThatCanBeStopped = () => {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  const getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  return { getUserMedia, tracks }
}

describe('joining a call', () => {
  // A push-to-talk join binds the key on the window, on a phone too.
  const keys = new Map<string, (e: unknown) => void>()

  beforeEach(() => {
    h.rooms.length = 0
    h.failConnect = false
    h.getVoiceToken.mockReset()
    keys.clear()
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: unknown) => void) => { keys.set(type, fn) },
      removeEventListener: (type: string) => { keys.delete(type) },
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    voice.mic = 'muted'
  })
  afterEach(async () => {
    await useVoice().leave()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    phone.isMobile.value = false
    phone.isCoarse.value = false
    resetPermits()
  })

  it('joining a push-to-talk call on a touch phone asks for the mic once and stops the tracks', async () => {
    phone.isMobile.value = true
    phone.isCoarse.value = true
    const { getUserMedia, tracks } = captureThatCanBeStopped()

    await join(true)

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    // Capturing and stopping at once is the whole point: the permission is
    // granted up front and nothing is left recording until someone holds the bar.
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1)
    expect(voice.mic).toBe('muted')
    expect(h.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  it('joining a push-to-talk call on desktop does not ask for the mic up front', async () => {
    const { getUserMedia } = captureThatCanBeStopped()

    await join(true)

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('a phone does not ask up front when the call is open mic', async () => {
    // Open mic publishes at join, which asks for the microphone by itself.
    phone.isMobile.value = true
    phone.isCoarse.value = true
    const { getUserMedia } = captureThatCanBeStopped()

    await join(false)

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('a phone with no capture API still joins push-to-talk', async () => {
    phone.isMobile.value = true
    phone.isCoarse.value = true
    vi.stubGlobal('navigator', {})   // no mediaDevices: not a secure origin

    await join(true)

    // Nothing to ask with, so nothing is asked and nothing throws: the join
    // lands as it did before the ask existed.
    expect(voice.connected).toBe(true)
    expect(voice.mic).toBe('muted')
  })

  it('a refused ask is reported and the phone still joins listen-only', async () => {
    phone.isMobile.value = true
    phone.isCoarse.value = true
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => { throw refusal('NotAllowedError') }) } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await join(true)

    expect(voice.mic).toBe('denied')
    expect(voice.connected).toBe(true)
  })

  it('leaving while the permission prompt is open does not bring the call back', async () => {
    // The prompt can sit there for as long as the person likes. Cancelling the
    // join meanwhile must be the end of it, not a call that appears afterwards.
    phone.isMobile.value = true
    phone.isCoarse.value = true
    let answer!: (stream: { getTracks: () => [] }) => void
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(done => { answer = done }) } })
    h.getVoiceToken.mockResolvedValue(tokenFor(true))

    await useVoice().connect('c1', 'channel', 'Lounge')
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    await useVoice().leave()
    answer({ getTracks: () => [] })
    await new Promise(r => setTimeout(r, 20))

    expect(voice.connected).toBe(false)
    expect(voice.activeConvId).toBeNull()
  })

  it('the push-to-talk key goes through the same press and release', async () => {
    await join(true)
    const setMic = h.rooms[0].localParticipant.setMicrophoneEnabled

    keys.get('keydown')!({ code: 'Space', repeat: false })
    await vi.waitFor(() => expect(setMic).toHaveBeenLastCalledWith(true, expect.anything(), undefined))
    // A held key repeats keydown; only the first press counts, as before.
    keys.get('keydown')!({ code: 'Space', repeat: true })
    expect(setMic).toHaveBeenCalledTimes(1)
    keys.get('keyup')!({ code: 'Space' })
    expect(setMic).toHaveBeenLastCalledWith(false)

    // A refused press from the key now says so too.
    setMic.mockRejectedValueOnce(refusal('NotReadableError'))
    keys.get('keydown')!({ code: 'Space', repeat: false })
    await vi.waitFor(() => expect(voice.mic).toBe('busy'))
  })
})

describe('connectedAt', () => {
  beforeEach(() => {
    h.rooms.length = 0
    h.failConnect = false
    h.getVoiceToken.mockReset()
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(async () => {
    await useVoice().leave()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetPermits()
  })

  it('connectedAt is set on connect, kept across a reconnect to the same conv, and cleared on leave', async () => {
    const clock = vi.spyOn(Date, 'now')
    expect(voice.connectedAt).toBeNull()

    clock.mockReturnValue(1_000)
    await join(false)
    expect(voice.connectedAt).toBe(1_000)

    // The media connection drops; the same call is rejoined seconds later. It
    // is one call, so the timer must carry on rather than restart at 0:00.
    clock.mockReturnValue(9_000)
    h.rooms[0].emit('disconnected')
    await vi.waitFor(() => expect(h.rooms).toHaveLength(2))
    await vi.waitFor(() => expect(voice.connected).toBe(true))
    expect(voice.activeConvId).toBe('c1')
    expect(voice.connectedAt).toBe(1_000)

    await useVoice().leave()
    expect(voice.connectedAt).toBeNull()

    // And the next call starts its own clock.
    clock.mockReturnValue(20_000)
    await join(false, 'c2')
    expect(voice.connectedAt).toBe(20_000)
  })

  it('connectedAt is cleared when the call gives up reconnecting', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.getVoiceToken.mockResolvedValue(tokenFor(false))
    await useVoice().connect('c1', 'channel', 'Lounge')
    await vi.waitFor(() => expect(voice.connected).toBe(true))
    expect(voice.connectedAt).not.toBeNull()

    h.failConnect = true
    h.rooms[0].emit('disconnected')
    // Fourteen attempts, 1.6 s apart, then "Couldn't connect".
    for (let i = 0; i < 14 && voice.connectStage !== 'failed'; i++) await vi.advanceTimersByTimeAsync(1_700)

    expect(voice.connectStage).toBe('failed')
    expect(voice.connectedAt).toBeNull()
  })
})
