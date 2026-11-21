/**
 * Signing out ends the call you are in, and any call you are still joining.
 *
 * Signing out does not reload the page: App.vue swaps the app for the sign-in
 * page. The call lives at module scope in useVoice, its voices play through
 * <audio> elements on <body>, and LiveKit holds its own connection, so none of
 * it went with the view. Someone who signed out mid-call stayed in the room:
 * still heard, still hearing everyone from the sign-in page, still a tile on
 * everybody's stage. A join under way carried on and could land after the
 * sign-out.
 *
 * Both ways a session ends count: Log out, and a session the server stops
 * renewing (signed out from another device, or a refresh token that lapsed),
 * which signs out without logout() ever running. A renewed access token or an
 * edited profile is the same person, and the call carries on.
 *
 * The real attemptConnect, useApi and useAuth run here, against a fake fetch
 * and a fake LiveKit room, as in voiceRefusal.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { PublicUser } from '../useAuth'

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

// What the media server does with a connection, and every room opened.
const h = vi.hoisted(() => ({
  /** null: LiveKit accepts the connection. Anything else: it rejects with this. */
  connectError: null as unknown,
  /** Set: the connection waits on this before it is accepted. */
  connectGate: null as Promise<void> | null,
  rooms: [] as Array<{ emit: (event: string, ...args: unknown[]) => void; disconnect: ReturnType<typeof vi.fn> }>,
}))

// The real enums and `Track`, a fake `Room`: the join only needs one that
// accepts, refuses or holds a connection, and records being disconnected.
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
    connect = vi.fn(() => {
      if (h.connectError !== null) return Promise.reject(h.connectError)
      return h.connectGate ?? Promise.resolve()
    })
    disconnect = vi.fn(async () => {})
  }
  return { ...real, Room: FakeRoom }
})

let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice
let useAuth: typeof import('../useAuth').useAuth
let silentRefresh: typeof import('../useAuth').silentRefresh
let getRoom: typeof import('../voiceRoom').getRoom

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
  ;({ useAuth, silentRefresh } = await import('../useAuth'))
  ;({ getRoom } = await import('../voiceRoom'))
})

// ── The API, as fetch answers useApi and useAuth ────────────────────────────

/** A response as far as useApi and useAuth read one. */
interface Reply { ok: boolean; status: number; json: () => Promise<unknown>; headers: { get: () => null } }
const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null },
})

const GRANTED = { token: 't', url: 'wss://sfu.test', room: 'voice:c1', voiceServer: null }

/** How the server answers POST /voice/token with a session. Set per test. */
let answer: () => Promise<Reply>
const answers = (status: number, body: unknown) => { answer = async () => reply(status, body) }

/** How the server answers POST /auth/refresh while the session is still its own. */
let refreshAnswer: () => Promise<Reply>
const refreshes = (status: number, body: unknown) => { refreshAnswer = async () => reply(status, body) }

/** POST /auth/logout ends the session on the server: its refresh cookie goes with it. */
let loggedOutOnServer = false

const bearer = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization ?? null

const fetchMock = vi.fn((path: string, init?: RequestInit) => {
  // As requireAuth answers a request that carries no access token.
  if (path === '/voice/token') return bearer(init) ? answer() : Promise.resolve(reply(401, { message: 'No token provided' }))
  if (path === '/auth/refresh') return loggedOutOnServer ? Promise.resolve(reply(401, { message: 'No refresh token' })) : refreshAnswer()
  if (path === '/auth/logout') { loggedOutOnServer = true; return Promise.resolve(reply(200, { message: 'Logged out' })) }
  return Promise.resolve(reply(404, {}))
})
const requestsTo = (to: string) => fetchMock.mock.calls.filter(([path]) => path === to).length

const ME: PublicUser = {
  id: 'u1', username: 'me', email: 'me@example.test', displayName: 'Me', discriminator: '0001',
  avatar: null, bio: '', role: 'member', status: 'online', isVerified: true,
  bannerColor: null, banner: null, customStatus: null, createdAt: '2026-01-01T00:00:00.000Z',
}

/**
 * Let everything already under way finish, without moving the clock: the
 * fake timers' async tick yields to the real event loop before it fires
 * anything, and nothing here is due at +0 ms.
 */
const settle = () => vi.advanceTimersByTimeAsync(0)

/** In the call, connected, and the room it is connected through. */
const inACall = async () => {
  answers(200, GRANTED)
  await useVoice().connect('c1', 'channel', 'Lounge')
  await settle()
  expect(voice.connected).toBe(true)
  return h.rooms[0]
}

/** Nothing of the call is left: no room held, nothing joining, nothing shown. */
const expectNoCall = () => {
  expect(getRoom()).toBeNull()
  expect(voice.connected).toBe(false)
  expect(voice.connecting).toBe(false)
  expect(voice.connectStage).toBeNull()
  expect(voice.connectingConvId).toBeNull()
  expect(voice.activeConvId).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers()
  h.rooms.length = 0
  h.connectError = null
  h.connectGate = null
  fetchMock.mockClear()
  loggedOutOnServer = false
  refreshes(200, { accessToken: 'renewed' })
  // Signed in, as the real session singleton.
  useAuth().user.value = { ...ME }
  useAuth().accessToken.value = 'access'
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  // Signed out before the globals go: signing out is a leave of its own, and
  // it must finish while requestAnimationFrame is still stubbed.
  useAuth().user.value = null
  useAuth().accessToken.value = null
  await useVoice().leave()
  await settle()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ── In a call ───────────────────────────────────────────────────────────────

describe('signing out of a call', () => {
  it('Log out leaves the call: the room is disconnected and nothing of the call is left', async () => {
    const room = await inACall()

    await useAuth().logout()
    await settle()

    expect(room.disconnect).toHaveBeenCalled()
    expectNoCall()
  })

  it('a session the server stops renewing leaves the call the same way', async () => {
    // Signed out from another device, or a refresh token that lapsed: the next
    // renewal is refused, which signs out without logout() ever running.
    const room = await inACall()
    refreshes(401, { message: 'Invalid or expired refresh token' })

    await expect(silentRefresh()).resolves.toBe(false)
    await settle()

    expect(useAuth().isAuthed.value).toBe(false)   // the sign-in page is what shows now
    expect(room.disconnect).toHaveBeenCalled()
    expectNoCall()
  })

  it('a renewed access token is the same person: the call carries on', async () => {
    // The token is renewed every 14 minutes, and by a join that found it lapsed.
    const room = await inACall()

    await expect(silentRefresh()).resolves.toBe(true)
    await settle()

    expect(useAuth().accessToken.value).toBe('renewed')
    expect(room.disconnect).not.toHaveBeenCalled()
    expect(voice.connected).toBe(true)
    expect(getRoom()).toBe(room)
  })

  it('an edited profile is the same person: the call carries on', async () => {
    // updateUser replaces the user object; who is signed in has not changed.
    const room = await inACall()

    useAuth().updateUser({ displayName: 'Someone new' })
    await settle()

    expect(room.disconnect).not.toHaveBeenCalled()
    expect(voice.connected).toBe(true)
    expect(getRoom()).toBe(room)
  })
})

// ── Still joining ───────────────────────────────────────────────────────────

describe('signing out of a call still joining', () => {
  it('a join waiting for its token opens no room, even when the token is granted afterwards', async () => {
    let grant!: (r: Reply) => void
    answer = () => new Promise<Reply>(resolve => { grant = resolve })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connecting).toBe(true)

    await useAuth().logout()
    grant(reply(200, GRANTED))
    await settle()

    expect(h.rooms).toHaveLength(0)
    expectNoCall()
  })

  it('a join waiting on the media server is dropped when the connection lands', async () => {
    let land!: () => void
    h.connectGate = new Promise<void>(resolve => { land = resolve })
    answers(200, GRANTED)
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connectStage).toBe('authenticating')
    const room = h.rooms[0]

    await useAuth().logout()
    land()
    await settle()

    expect(room.disconnect).toHaveBeenCalled()
    expectNoCall()
  })

  it('a join between tries stops at once, and nothing more is asked', async () => {
    h.connectError = new Error('could not establish pc connection')
    answers(200, GRANTED)
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connectStage).toBe('no-route')   // waiting out the pause before the next try

    await useAuth().logout()
    await settle()

    // At once, not at the next try: the strip is gone with the call.
    expectNoCall()
    // And no try follows, not even one that would find the session gone.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(requestsTo('/voice/token')).toBe(1)
    expect(requestsTo('/auth/refresh')).toBe(0)
    expect(h.rooms).toHaveLength(1)
  })

  it('a join whose lapsed session cannot be renewed still ends with it, quietly', async () => {
    // voiceRefusal.test.ts pins this with nobody signed in. Signed in, as in the
    // app, the refused renewal is a sign-out, and the leave that follows ends
    // the join before the join's own check for it. The end is the same: no
    // failure shown, and nothing more asked.
    answers(401, { message: 'Invalid or expired token' })
    refreshes(401, { message: 'Invalid or expired refresh token' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(useAuth().isAuthed.value).toBe(false)
    expectNoCall()
    expect(voice.failReason).toBeNull()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(requestsTo('/voice/token')).toBe(1)
    expect(requestsTo('/auth/refresh')).toBe(1)
    expect(h.rooms).toHaveLength(0)
  })
})
