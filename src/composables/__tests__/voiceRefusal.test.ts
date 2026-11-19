/**
 * A call the server refuses stops at once and says why.
 *
 * Every failed join used to go round the same loop: a red "No route", another
 * try 1.6 s later, fourteen times over, then "Couldn't connect". That suits a
 * network that dropped or a media server that is busy, either of which may
 * answer the next try. It does not suit a token request the server turned
 * down — not a member, not allowed in, no such channel — which gives the same
 * answer every time. The person watched about twenty seconds of "No route"
 * and was then told nothing about why.
 *
 * A 4xx answer to the token request now ends the join on the spot, and the
 * failure carries the server's own words where "Couldn't connect" used to be.
 * Everything that may still succeed keeps the old loop: no answer at all, a
 * 5xx, a 429 and any failure past the token, LiveKit's own included.
 *
 * A 401 is neither. It is the session that lapsed, not the call that was
 * refused: the access token died, most often while the machine slept. The
 * join renews the session once and asks again within the same attempt, so
 * nobody sees "No route" for it; a session that cannot be renewed has been
 * signed out, and the join ends with it.
 *
 * The real attemptConnect, useApi and useAuth run here, against a fake fetch
 * and a fake LiveKit room, so the error is exactly what useApi throws.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { watch } from 'vue'

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
  rooms: [] as Array<{ emit: (event: string, ...args: unknown[]) => void }>,
}))

// The real enums and `Track`, a fake `Room`: the join only needs one that
// accepts or refuses a connection and can be told it dropped.
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
    connect = vi.fn(() => (h.connectError === null ? Promise.resolve() : Promise.reject(h.connectError)))
    disconnect = vi.fn(async () => {})
  }
  return { ...real, Room: FakeRoom }
})

let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice
let joinProgress: typeof import('../callStatus').joinProgress
let useAuth: typeof import('../useAuth').useAuth

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
  ;({ joinProgress } = await import('../callStatus'))
  ;({ useAuth } = await import('../useAuth'))
})

// ── The API, as fetch answers useApi ────────────────────────────────────────

/** A response as far as useApi reads one: ok, status, the body, the headers. */
interface Reply { ok: boolean; status: number; json: () => Promise<unknown>; headers: { get: () => null } }
const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null },
})

const GRANTED = { token: 't', url: 'wss://sfu.test', room: 'voice:c1', voiceServer: null }

/** How the server answers POST /voice/token. Set per test. */
let answer: () => Promise<Reply>
const answers = (status: number, body: unknown) => { answer = async () => reply(status, body) }
const unreachable = () => { answer = () => Promise.reject(new TypeError('Failed to fetch')) }
/** Answers in turn, one per token request; the last one stands after that. */
const answersInTurn = (...turns: Array<[number, unknown]>) => {
  let next = 0
  answer = async () => reply(...turns[Math.min(next++, turns.length - 1)])
}

/** How the server answers POST /auth/refresh. Renews the session unless a test says otherwise. */
let refreshAnswer: () => Promise<Reply>
const refreshes = (status: number, body: unknown) => { refreshAnswer = async () => reply(status, body) }

const fetchMock = vi.fn((path: string, _init?: RequestInit) => {
  if (path === '/voice/token') return answer()
  if (path === '/auth/refresh') return refreshAnswer()
  return Promise.resolve(reply(404, {}))
})
const requestsTo = (to: string) => fetchMock.mock.calls.filter(([path]) => path === to)
const tokenRequests = () => requestsTo('/voice/token').length
const refreshRequests = () => requestsTo('/auth/refresh').length
/** The access token each token request carried, in order. */
const bearers = () => requestsTo('/voice/token')
  .map(([, init]) => (init?.headers as Record<string, string> | undefined)?.Authorization ?? null)

const LAPSED = { message: 'Invalid or expired token' }

/**
 * Let everything already under way finish, without moving the clock: the
 * fake timers' async tick yields to the real event loop before it fires
 * anything, and nothing here is due at +0 ms.
 */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  h.rooms.length = 0
  h.connectError = null
  fetchMock.mockClear()
  // The real session singleton: a token to send, and a refresh that renews it.
  useAuth().accessToken.value = 'stale'
  refreshes(200, { accessToken: 'fresh' })
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

// ── Refused ─────────────────────────────────────────────────────────────────

describe('a token request the server refuses', () => {
  it.each([
    ['channel', 403, 'You cannot join this voice channel'],
    ['channel', 403, 'You are not a member of this server'],
    ['channel', 404, 'Channel not found'],
    ['channel', 400, 'That is not a voice channel'],
    ['group', 403, 'You are not a member of this group'],
    ['dm', 404, 'User not found'],
  ] as const)('a %s call answered %i stops at once, saying "%s"', async (kind, status, message) => {
    answers(status, { message })
    await useVoice().connect('c1', kind, 'Lounge')
    await settle()

    // Before any retry timer could have run: no red "No route" flash first.
    expect(voice.connectStage).toBe('failed')
    expect(voice.connecting).toBe(false)
    expect(voice.failReason).toBe(message)
    expect(joinProgress(voice)).toEqual({ label: message, failing: true })

    // And it is not asked again: the answer would be the same.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenRequests()).toBe(1)
  })

  it('a refusal with no words of its own still stops at once, as "Couldn’t connect"', async () => {
    answers(403, {})
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('failed')
    expect(voice.failReason).toBeNull()
    expect(joinProgress(voice)).toEqual({ label: 'Couldn’t connect', failing: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenRequests()).toBe(1)
  })

  it('is held on screen as long as any failure, then the call is left and the reason goes with it', async () => {
    answers(404, { message: 'Channel not found' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connectStage).toBe('failed')

    await vi.advanceTimersByTimeAsync(9_000)
    expect(voice.connectStage).toBe('failed')
    expect(voice.failReason).toBe('Channel not found')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(voice.connectStage).toBeNull()
    expect(voice.connectingConvId).toBeNull()
    expect(voice.failReason).toBeNull()
  })

  it('hanging up during the hold clears the reason', async () => {
    answers(403, { message: 'You cannot join this voice channel' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.failReason).toBe('You cannot join this voice channel')

    await useVoice().leave()
    expect(voice.connectStage).toBeNull()
    expect(voice.failReason).toBeNull()
  })

  it('a call that dropped and is refused on the way back stops at once too', async () => {
    answers(200, GRANTED)
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connected).toBe(true)

    answers(403, { message: 'You cannot join this voice channel' })
    h.rooms[0].emit('disconnected')
    await settle()

    expect(voice.connectStage).toBe('failed')
    expect(voice.connected).toBe(false)
    expect(voice.connectedAt).toBeNull()
    expect(joinProgress(voice)).toEqual({ label: 'You cannot join this voice channel', failing: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenRequests()).toBe(2)
  })

  it('a refusal that arrives after Cancel changes nothing', async () => {
    let release!: (r: Reply) => void
    answer = () => new Promise<Reply>(resolve => { release = resolve })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connecting).toBe(true)

    await useVoice().leave()
    release(reply(403, { message: 'You cannot join this voice channel' }))
    await settle()

    expect(voice.connectStage).toBeNull()
    expect(voice.connecting).toBe(false)
    expect(voice.failReason).toBeNull()
  })

  it('the reason does not carry into the next call, even one started during the hold', async () => {
    answers(403, { message: 'You cannot join this voice channel' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.failReason).toBe('You cannot join this voice channel')

    // Another call, while the refusal is still on screen, on a network that is down.
    unreachable()
    await useVoice().connect('c2', 'channel', 'Studio')
    await settle()
    expect(voice.failReason).toBeNull()
    expect(joinProgress(voice)).toEqual({ label: 'No route', failing: true })

    // Fourteen attempts, 1.6 s apart, and then the generic words, not the old reason.
    for (let i = 0; i < 14 && voice.connectStage !== 'failed'; i++) await vi.advanceTimersByTimeAsync(1_700)
    expect(voice.connectStage).toBe('failed')
    expect(joinProgress(voice)).toEqual({ label: 'Couldn’t connect', failing: true })
  })
})

// ── Not refused: worth another try ──────────────────────────────────────────

describe('a failure that may pass keeps retrying', () => {
  it.each([
    ['no answer at all', unreachable],
    ['a 429', () => answers(429, { message: 'Too many requests — wait a moment' })],
    ['a 500', () => answers(500, {})],
    ['a 503', () => answers(503, { message: 'Voice is not configured on this server' })],
  ])('%s: "No route", then another try', async (_what, arrange) => {
    arrange()
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('no-route')
    expect(voice.connecting).toBe(true)
    expect(voice.failReason).toBeNull()
    expect(joinProgress(voice)).toEqual({ label: 'No route', failing: true })

    await vi.advanceTimersByTimeAsync(1_600)
    expect(tokenRequests()).toBe(2)
  })

  it('a media server that turns the connection away is retried, whatever status it gives', async () => {
    // LiveKit's own connection errors carry a status as well. Only the token
    // request is the server's answer about the call; this one is retried.
    answers(200, GRANTED)
    h.connectError = Object.assign(new Error('could not establish signal connection'), { status: 403 })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('no-route')
    expect(voice.failReason).toBeNull()
    await vi.advanceTimersByTimeAsync(1_600)
    expect(tokenRequests()).toBe(2)
    expect(h.rooms.length).toBe(2)
  })
})

// ── A lapsed session: renewed once, and asked again ─────────────────────────

describe('a 401 to the token request: the session lapsed', () => {
  it('is renewed and asked again at once, so the call joins with no "No route" and no "Trying again…"', async () => {
    answersInTurn([401, LAPSED], [200, GRANTED])
    const seen: string[] = []
    const stop = watch(() => joinProgress(voice)?.label, label => { if (label) seen.push(label) }, { flush: 'sync' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()   // the clock has not moved: no retry timer ran
    stop()

    expect(voice.connected).toBe(true)
    expect(seen).not.toContain('No route')
    expect(seen).not.toContain('Trying again…')
    expect(refreshRequests()).toBe(1)
    expect(bearers()).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('a renewed session can still be refused, and that stops at once with the reason', async () => {
    answersInTurn([401, LAPSED], [403, { message: 'You cannot join this voice channel' }])
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('failed')
    expect(voice.failReason).toBe('You cannot join this voice channel')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenRequests()).toBe(2)
    expect(refreshRequests()).toBe(1)
  })

  it('once per join: a 401 that comes back on the renewed token goes round the loop, with no second refresh', async () => {
    answers(401, LAPSED)
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('no-route')
    expect(voice.failReason).toBeNull()
    expect(tokenRequests()).toBe(2)
    expect(refreshRequests()).toBe(1)

    await vi.advanceTimersByTimeAsync(1_600)
    expect(tokenRequests()).toBe(3)
    expect(refreshRequests()).toBe(1)
  })

  it('a refresh that gets no answer leaves the session as it was and goes round the loop; the next try renews it', async () => {
    answers(401, LAPSED)
    refreshAnswer = () => Promise.reject(new TypeError('Failed to fetch'))
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(voice.connectStage).toBe('no-route')
    expect(useAuth().accessToken.value).toBe('stale')
    expect(tokenRequests()).toBe(1)

    // The network is back: no refresh has worked yet in this join, so it may try one.
    refreshes(200, { accessToken: 'fresh' })
    answersInTurn([401, LAPSED], [200, GRANTED])
    await vi.advanceTimersByTimeAsync(1_600)
    expect(voice.connected).toBe(true)
    expect(refreshRequests()).toBe(2)
    expect(bearers()).toEqual(['Bearer stale', 'Bearer stale', 'Bearer fresh'])
  })

  it('a session that cannot be renewed has been signed out, and the join ends with it, quietly', async () => {
    answers(401, LAPSED)
    refreshes(401, { message: 'Invalid or expired refresh token' })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()

    expect(useAuth().accessToken.value).toBeNull()
    expect(voice.connecting).toBe(false)
    expect(voice.connectStage).toBeNull()
    expect(voice.connectingConvId).toBeNull()
    expect(voice.failReason).toBeNull()
    // Nothing more is asked: with no session behind it, no answer could pass.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tokenRequests()).toBe(1)
  })

  it('a refresh that lands after Cancel asks nothing more', async () => {
    answers(401, LAPSED)
    let release!: (r: Reply) => void
    refreshAnswer = () => new Promise<Reply>(resolve => { release = resolve })
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(refreshRequests()).toBe(1)

    await useVoice().leave()
    release(reply(200, { accessToken: 'fresh' }))
    await settle()

    expect(tokenRequests()).toBe(1)
    expect(voice.connecting).toBe(false)
    expect(voice.connectStage).toBeNull()
  })

  it('a call that drops as the machine wakes: no network at first, then the lapsed token, renewed, and back in', async () => {
    answers(200, GRANTED)
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connected).toBe(true)

    // Waking: the network is not back yet, and the token died during the sleep.
    unreachable()
    h.rooms[0].emit('disconnected')
    await settle()
    expect(voice.connectStage).toBe('no-route')

    answersInTurn([401, LAPSED], [200, GRANTED])
    await vi.advanceTimersByTimeAsync(1_600)
    expect(voice.connected).toBe(true)
    expect(refreshRequests()).toBe(1)
    expect(bearers().slice(-2)).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('each join has its own: a call renewed on the way in is renewed again when it drops onto a lapsed session', async () => {
    answersInTurn([401, LAPSED], [200, GRANTED])
    await useVoice().connect('c1', 'channel', 'Lounge')
    await settle()
    expect(voice.connected).toBe(true)
    expect(refreshRequests()).toBe(1)

    // Long enough later that the renewed token has lapsed as well.
    useAuth().accessToken.value = 'stale again'
    refreshes(200, { accessToken: 'fresh again' })
    answersInTurn([401, LAPSED], [200, GRANTED])
    h.rooms[0].emit('disconnected')
    await settle()

    expect(voice.connected).toBe(true)
    expect(refreshRequests()).toBe(2)
    expect(bearers().slice(-2)).toEqual(['Bearer stale again', 'Bearer fresh again'])
  })
})
