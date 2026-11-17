/**
 * Starting a video call from the conversation header: join, then the camera.
 *
 * The header's video button opens the camera preview, and confirming it has to
 * join the call before the camera can go live: toggleCamera reaches for the
 * room, which does not exist until the join lands. connect() only STARTS the
 * join. attemptConnect runs on by itself, through the token request, the media
 * connection and any retries. So ChatApp's `voice.connected` check straight
 * after `await connect()` was always false, and the camera never came on.
 * whenJoined is what it waits on instead.
 *
 * The real attemptConnect and the real toggleCamera run against a fake LiveKit
 * room, so what is pinned is the camera actually being asked for on the room
 * the join produced. A wait that resolved too early would reach toggleCamera
 * with no room, which returns quietly and publishes nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import type { JoinWait } from '../whenJoined'

// Same three stubs, for the same reasons, as voicePtt.test.ts: useVoice.ts
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
  rooms: [] as Array<{ localParticipant: { setCameraEnabled: ReturnType<typeof vi.fn> } }>,
}))

vi.mock('../useApi', () => ({
  useApi: () => ({ getVoiceToken: h.getVoiceToken, moveVoiceCall: vi.fn() }),
}))

// The real enums and `Track`, a fake `Room`: one that accepts a connection (or
// refuses it, on request) and has a camera that remembers being switched.
vi.mock('livekit-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('livekit-client')>()
  class FakeRoom {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    localParticipant = {
      identity: 'me', name: 'Me', isSpeaking: false, isMicrophoneEnabled: false,
      isCameraEnabled: false,
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async (on: boolean) => { this.localParticipant.isCameraEnabled = on }),
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

let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice
let whenJoined: typeof import('../whenJoined').whenJoined
let toggleCamera: typeof import('../useVoiceMedia').toggleCamera
let media: typeof import('../useVoiceMedia').media
let resetPermits: typeof import('../voicePermits').resetPermits

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

  ;({ voice, useVoice } = await import('../useVoice'))
  ;({ whenJoined } = await import('../whenJoined'))
  ;({ toggleCamera, media } = await import('../useVoiceMedia'))
  ;({ resetPermits } = await import('../voicePermits'))
})

const TOKEN = { token: 't', url: 'wss://sfu.test', voiceServer: null }

/** The next token request answers only when the returned function is called. */
const holdNextToken = (): (() => void) => {
  let answer!: () => void
  h.getVoiceToken.mockImplementationOnce(() => new Promise(resolve => { answer = () => resolve(TOKEN) }))
  return () => answer()
}

/** whenJoined, run inside a scope of its own so the test can see what it leaves watching. */
const waitIn = (convId: string): { wait: JoinWait; scope: EffectScope } => {
  const scope = effectScope()
  const wait = scope.run(() => whenJoined(convId))!
  return { wait, scope }
}

/** How many watchers the wait has left running. `effects` is Vue's own list; it is not in the public types. */
const watching = (scope: EffectScope): number => (scope as unknown as { effects: unknown[] }).effects.length

/** onCameraConfirmed's next step: the camera, only once the join has landed. */
const cameraOnceLanded = async (wait: JoinWait): Promise<void> => {
  if (await wait.landed) await toggleCamera()
}

/** Every switch of every camera, on every room any join opened, in order. */
const cameraCalls = (): boolean[] => h.rooms.flatMap(r => r.localParticipant.setCameraEnabled.mock.calls.map(c => c[0] as boolean))

beforeEach(() => {
  h.rooms.length = 0
  h.failConnect = false
  h.getVoiceToken.mockReset()
  h.getVoiceToken.mockResolvedValue(TOKEN)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  // A camera to enumerate, and no microphone capture: the join goes in
  // listen-only, which is all these need of it.
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => [] } })
})
afterEach(async () => {
  await useVoice().leave()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetPermits()
})

describe('why the camera never came on', () => {
  it('connect() resolves while the join is still on its way', async () => {
    // Characterisation, true before the fix too: this is what made
    // onCameraConfirmed's `if (!voice.connected) return` stop every time.
    const answerToken = holdNextToken()
    await useVoice().connect('c1', 'dm', 'Ada')

    expect(voice.connected).toBe(false)
    expect(voice.connecting).toBe(true)

    answerToken()
    await vi.waitFor(() => expect(voice.connected).toBe(true))
  })
})

describe('whenJoined: starting a video call', () => {
  it('turns the camera on once the join lands, on the room the join opened', async () => {
    const answerToken = holdNextToken()
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    answerToken()

    await cameraOnceLanded(wait)
    await vi.waitFor(() => expect(voice.connected).toBe(true))

    expect(h.rooms).toHaveLength(1)
    // Asked once, to go on: not left off, and not on and straight back off.
    expect(cameraCalls()).toEqual([true])
    expect(media.localCamOn).toBe(true)
    expect(watching(scope)).toBe(0)
  })

  it('waits through a retry and turns the camera on when a later attempt lands', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.failConnect = true
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    const camera = cameraOnceLanded(wait)

    await vi.waitFor(() => expect(voice.connectStage).toBe('no-route'))
    // The red "No route" flash keeps `connecting` up: still the same join.
    expect(watching(scope)).toBe(1)
    h.failConnect = false
    await vi.advanceTimersByTimeAsync(1_700)
    await camera

    expect(voice.connected).toBe(true)
    expect(h.rooms).toHaveLength(2)
    expect(h.rooms[1].localParticipant.setCameraEnabled.mock.calls.map(c => c[0])).toEqual([true])
    expect(cameraCalls()).toEqual([true])
    expect(watching(scope)).toBe(0)
  })

  it('a call that is already up resolves at once, with nothing to watch', async () => {
    await useVoice().connect('c1', 'dm', 'Ada')
    await vi.waitFor(() => expect(voice.connected).toBe(true))

    const { wait, scope } = waitIn('c1')

    expect(watching(scope)).toBe(0)
    await expect(wait.landed).resolves.toBe(true)
  })
})

describe('whenJoined: a join that does not land never turns the camera on', () => {
  it('the join giving up resolves false', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.failConnect = true
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    const camera = cameraOnceLanded(wait)

    // Fourteen attempts, 1.6 s apart, then "Couldn't connect".
    for (let i = 0; i < 14 && voice.connectStage !== 'failed'; i++) await vi.advanceTimersByTimeAsync(1_700)
    expect(voice.connectStage).toBe('failed')

    await expect(wait.landed).resolves.toBe(false)
    await camera
    expect(cameraCalls()).toEqual([])
    expect(watching(scope)).toBe(0)
  })

  it('the join cancelled before it lands resolves false, and its late token brings nothing back', async () => {
    const answerToken = holdNextToken()
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    const camera = cameraOnceLanded(wait)

    await useVoice().leave()
    answerToken()

    await expect(wait.landed).resolves.toBe(false)
    await camera
    await new Promise(r => setTimeout(r, 20))   // the cancelled attempt runs out
    expect(voice.connected).toBe(false)
    expect(cameraCalls()).toEqual([])
    expect(watching(scope)).toBe(0)
  })

  it('another call started meanwhile resolves false, and that call landing does not switch the camera on', async () => {
    const answerC1 = holdNextToken()
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    const camera = cameraOnceLanded(wait)

    await useVoice().connect('c2', 'dm', 'Grace')
    await vi.waitFor(() => expect(voice.connected).toBe(true))
    expect(voice.activeConvId).toBe('c2')
    answerC1()

    await expect(wait.landed).resolves.toBe(false)
    await camera
    expect(cameraCalls()).toEqual([])
    expect(watching(scope)).toBe(0)
  })

  it('nothing joining that call resolves false at once, with nothing to watch', async () => {
    const { wait, scope } = waitIn('c1')

    expect(watching(scope)).toBe(0)
    await expect(wait.landed).resolves.toBe(false)
  })

  it('a call up elsewhere is not this one: false at once', async () => {
    await useVoice().connect('c2', 'dm', 'Grace')
    await vi.waitFor(() => expect(voice.connected).toBe(true))

    await expect(waitIn('c1').wait.landed).resolves.toBe(false)
  })
})

describe('whenJoined: cancel', () => {
  it('ends the wait with false and stops watching; the join itself carries on and lands without the camera', async () => {
    const answerToken = holdNextToken()
    await useVoice().connect('c1', 'dm', 'Ada')
    const { wait, scope } = waitIn('c1')
    const camera = cameraOnceLanded(wait)

    wait.cancel()
    expect(watching(scope)).toBe(0)
    await expect(wait.landed).resolves.toBe(false)

    answerToken()
    await vi.waitFor(() => expect(voice.connected).toBe(true))
    await camera
    expect(cameraCalls()).toEqual([])
  })

  it('is harmless once the wait has settled', async () => {
    await useVoice().connect('c1', 'dm', 'Ada')
    await vi.waitFor(() => expect(voice.connected).toBe(true))
    const { wait } = waitIn('c1')

    wait.cancel()

    await expect(wait.landed).resolves.toBe(true)
  })
})
