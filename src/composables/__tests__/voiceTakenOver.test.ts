/**
 * Joining the same call on another device takes it over; it does not start a
 * fight.
 *
 * LiveKit lets one connection per person into a room. When the phone joins a
 * call the PC is in, the media server drops the PC with DUPLICATE_IDENTITY.
 * The PC treated that like any other drop and rejoined at once — which
 * dropped the phone, which rejoined, which dropped the PC, every second or
 * two, for as long as both stayed open. Each round trip was a leave and a join
 * on everybody's stage, and whichever device was hung up first told the server
 * the person had left the call they were still in on the other one.
 *
 * Now the device that was taken over leaves the call quietly, and every other
 * kind of drop still rejoins as before. A drop reported by a room this device
 * already let go of changes nothing.
 *
 * The real attemptConnect runs against a fake LiveKit room and a fake fetch,
 * as in voiceRefusal.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { DisconnectReason, RoomEvent } from 'livekit-client'

vi.mock('../micChain', () => ({ createMicChainProcessor: () => ({}) }))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {}, holdPresence: () => {} }))
vi.mock('../materialScheme', () => ({ SCHEME_TOKEN_KEYS: [], buildSchemeTokens: () => ({}) }))

/** What the client told the server about the call, in order. */
const said = vi.hoisted(() => [] as string[])

vi.mock('../useSocket', async () => {
  const { ref } = await import('vue')
  return {
    connected: ref(true),
    getSocket: () => ({ emit: () => {} }),
    emitCallJoin:   () => { said.push('call:join') },
    emitCallLeave:  (_id: string, _kind: string, reason?: string) => {
      said.push(reason ? `call:leave (${reason})` : 'call:leave')
    },
    emitCallRejoin: () => { said.push('call:rejoin') },
    callServerMoved: ref(null),
    soundCallJoin: () => {}, soundCallLeave: () => {},
    soundUserJoin: () => {}, soundUserLeave: () => {},
    soundMute: () => {}, soundUnmute: () => {},
    soundDeafen: () => {}, soundUndeafen: () => {},
  }
})

const h = vi.hoisted(() => ({
  rooms: [] as Array<{ emit: (event: string, ...args: unknown[]) => void }>,
}))

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
    connect = vi.fn(() => Promise.resolve())
    disconnect = vi.fn(async () => {})
  }
  return { ...real, Room: FakeRoom }
})

let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice

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
})

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null },
})
const fetchMock = vi.fn((path: string) => Promise.resolve(path === '/voice/token'
  ? reply(200, { token: 't', url: 'wss://sfu.test', room: 'voice:c1', voiceServer: null })
  : reply(404, {})))
const tokenRequests = () => fetchMock.mock.calls.filter(([path]) => path === '/voice/token').length

const settle = () => vi.advanceTimersByTimeAsync(0)

/** In a call, joined on the first try. */
const joined = async () => {
  await useVoice().connect('c1', 'channel', 'Lounge')
  await settle()
  expect(voice.connected).toBe(true)
  said.length = 0
  fetchMock.mockClear()
}

beforeEach(() => {
  vi.useFakeTimers()
  h.rooms.length = 0
  said.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  await useVoice().leave()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the same call joined on another device', () => {
  it('leaves the call here instead of joining it back', async () => {
    await joined()

    h.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY)
    await vi.advanceTimersByTimeAsync(30_000)

    // No rejoin: that would take the call back from the other device.
    expect(tokenRequests()).toBe(0)
    expect(h.rooms).toHaveLength(1)
    expect(voice.connected).toBe(false)
    expect(voice.connecting).toBe(false)
    expect(voice.activeConvId).toBeNull()
  })

  it('tells the server this device is out of the call, and nothing else', async () => {
    await joined()

    h.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY)
    await settle()

    // Not a hang-up: the person is still in the call, on the other device, and
    // the server keeps the call alive until that device's join lands.
    expect(said).toEqual(['call:leave (taken-over)'])
  })
})

describe('every other drop', () => {
  it.each([
    ['the media server closing the connection', DisconnectReason.SIGNAL_CLOSE],
    ['no reason at all', undefined],
  ])('still rejoins after %s', async (_label, reason) => {
    await joined()

    h.rooms[0].emit(RoomEvent.Disconnected, reason)
    await settle()

    expect(tokenRequests()).toBe(1)
    expect(h.rooms).toHaveLength(2)
    await settle()
    expect(voice.connected).toBe(true)
    expect(said).toContain('call:join')
  })
})

describe('a room this device already let go of', () => {
  it('cannot end or restart the call that replaced it', async () => {
    await joined()
    // A drop rejoins on a new room; the old one is torn down.
    h.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE)
    await settle()
    await settle()
    expect(h.rooms).toHaveLength(2)
    expect(voice.connected).toBe(true)
    said.length = 0
    fetchMock.mockClear()

    // The old room reports its end late. It is not the call any more.
    h.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY)
    h.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(voice.connected).toBe(true)
    expect(voice.activeConvId).toBe('c1')
    expect(tokenRequests()).toBe(0)
    expect(said).toEqual([])
  })
})
