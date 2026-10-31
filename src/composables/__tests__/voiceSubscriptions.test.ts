/**
 * What a member downloads from a call: the wiring around subscriptionPolicy.
 *
 * The bug: being in a call where a song was playing made you hear it. The
 * room connected with LiveKit's default autoSubscribe, so the music track
 * was subscribed with the room, and the sweep meant to drop it ran on
 * Connected — before `getRoom()` was set, so it found no room and did
 * nothing. Joining a call meant joining whatever song was on.
 *
 * The fix turns autoSubscribe off and lets one policy decide everything.
 * That makes these tests the voice path's safety net as much as the music
 * fix's proof: with nothing automatic left, a mic or camera that no handler
 * subscribes is a person nobody can hear or see. So beyond the bug, they
 * pin every way a voice reaches you — already in the room, joining after
 * you, publishing late, republishing, and both kinds of reconnect.
 *
 * The real `attemptConnect` runs against a fake LiveKit room, as in
 * voicePtt.test.ts. The fake gives every publication the subscription LiveKit
 * would: `subscribed = autoSubscribe`, defaulting to true, exactly as
 * RemoteTrackPublication's constructor does. That is what lets the music
 * test fail on the old code for the old reason.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

// Same stubs, for the same reasons, as voicePtt.test.ts: useVoice.ts reaches
// the mic chain (RNNoise wasm/AudioWorklet), usePresence (localStorage at
// module load) and, through usePerformance, the Material You colour utilities.
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

/** A publication as far as the subscription code can see one. */
interface FakePub {
  trackSid: string
  source: string
  kind: 'audio' | 'video'
  trackName: string
  desired: boolean
  readonly isDesired: boolean
  setSubscribed: ReturnType<typeof vi.fn>
  setVideoQuality: ReturnType<typeof vi.fn>
  setEnabled: ReturnType<typeof vi.fn>
}
interface FakePerson {
  identity: string
  name: string
  isSpeaking: boolean
  isMicrophoneEnabled: boolean
  trackPublications: Map<string, FakePub>
  readonly videoTrackPublications: Map<string, FakePub>
}
interface FakeRoomShape {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  remoteParticipants: Map<string, FakePerson>
  emit: (event: string, ...args: unknown[]) => void
  arrive: (identity: string, pubs: FakePub[]) => FakePerson
  publish: (identity: string, pub: FakePub) => void
  unpublish: (identity: string, pub: FakePub) => void
}

const h = vi.hoisted(() => ({
  getVoiceToken: vi.fn(),
  rooms: [] as FakeRoomShape[],
  /** Who is already in the room when we join, built fresh for every room. */
  seed: (() => ({})) as () => Record<string, FakePub[]>,
  /** Runs inside connect, right after Connected, before connect resolves. */
  onConnected: null as null | (() => void),
  person: null as unknown as (identity: string, pubs: FakePub[]) => FakePerson,
}))

vi.mock('../useApi', () => ({
  useApi: () => ({ getVoiceToken: h.getVoiceToken, moveVoiceCall: vi.fn() }),
}))

// The real enums and `Track`, a fake `Room` that behaves like LiveKit's in the
// one way that matters here: what is subscribed before any of our code runs.
vi.mock('livekit-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('livekit-client')>()
  const { RoomEvent } = real

  h.person = (identity, pubs) => ({
    identity, name: identity, isSpeaking: false, isMicrophoneEnabled: true,
    trackPublications: new Map(pubs.map(p => [p.trackSid, p])),
    get videoTrackPublications() {
      return new Map([...this.trackPublications].filter(([, p]) => p.kind === 'video'))
    },
  })

  class FakeRoom implements FakeRoomShape {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    /** LiveKit's default; replaced by whatever connect is given. */
    private autoSubscribe = true
    localParticipant = {
      identity: 'me', name: 'Me', isSpeaking: false, isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async () => undefined),
      getTrackPublication: () => undefined,
    }
    remoteParticipants = new Map<string, FakePerson>()
    constructor() { h.rooms.push(this) }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
      return this
    }
    emit(event: string, ...args: unknown[]) { this.handlers.get(event)?.forEach(fn => fn(...args)) }

    /** As RemoteTrackPublication's constructor: `this.subscribed = autoSubscribe`. */
    private created(pub: FakePub) { pub.desired = this.autoSubscribe }

    // LiveKit fills the room from the join response, raising no per-track
    // events for it, then emits Connected, then resolves.
    connect = vi.fn(async (_url: string, _token: string, opts?: { autoSubscribe?: boolean }) => {
      this.autoSubscribe = opts?.autoSubscribe ?? true
      for (const [identity, pubs] of Object.entries(h.seed())) {
        pubs.forEach(p => this.created(p))
        this.remoteParticipants.set(identity, h.person(identity, pubs))
      }
      this.emit(RoomEvent.Connected)
      h.onConnected?.()
    })
    disconnect = vi.fn(async () => {})

    /** Someone joins after us with tracks already on them, announced by ParticipantConnected alone. */
    arrive(identity: string, pubs: FakePub[]) {
      pubs.forEach(p => this.created(p))
      const p = h.person(identity, pubs)
      this.remoteParticipants.set(identity, p)
      this.emit(RoomEvent.ParticipantConnected, p)
      return p
    }
    publish(identity: string, pub: FakePub) {
      const p = this.remoteParticipants.get(identity)!
      this.created(pub)
      p.trackPublications.set(pub.trackSid, pub)
      this.emit(RoomEvent.TrackPublished, pub, p)
    }
    unpublish(identity: string, pub: FakePub) {
      const p = this.remoteParticipants.get(identity)!
      p.trackPublications.delete(pub.trackSid)
      this.emit(RoomEvent.TrackUnpublished, pub, p)
    }
  }
  return { ...real, Room: FakeRoom }
})

let Track: typeof import('livekit-client').Track
let RoomEvent: typeof import('livekit-client').RoomEvent
let voice: typeof import('../useVoice').voice
let useVoice: typeof import('../useVoice').useVoice
let joinedStreams: Set<string>
let music: typeof import('../useMusic').music
let listenToMusic: typeof import('../useMusic').listenToMusic
let createMusicChannel: typeof import('../useMusic').createMusicChannel
let shareToChannel: typeof import('../useMusic').shareToChannel
let onMusicState: typeof import('../useMusic').onMusicState
let MUSIC_IDENTITY: string
let perf: typeof import('../usePerformance').perf
let nextTick: typeof import('vue').nextTick

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

  ;({ Track, RoomEvent } = await import('livekit-client'))
  ;({ nextTick } = await import('vue'))
  const v = await import('../useVoice')
  voice = v.voice
  useVoice = v.useVoice
  joinedStreams = (v as unknown as { joinedStreams: Set<string> }).joinedStreams
  ;({ music, listenToMusic, createMusicChannel, shareToChannel, onMusicState, MUSIC_IDENTITY } = await import('../useMusic'))
  ;({ perf } = await import('../usePerformance'))
})

let sid = 0
const pubOf = (source: string, kind: 'audio' | 'video', trackName = ''): FakePub => {
  const p: FakePub = {
    trackSid: `TR_${++sid}`, source, kind, trackName,
    desired: false,
    get isDesired() { return p.desired },
    setSubscribed: vi.fn((on: boolean) => { p.desired = on }),
    setVideoQuality: vi.fn(),
    setEnabled: vi.fn(),
  }
  return p
}
const mic = () => pubOf(Track.Source.Microphone, 'audio')
const camera = () => pubOf(Track.Source.Camera, 'video')
const screen = () => pubOf(Track.Source.ScreenShare, 'video')
const screenAudio = () => pubOf(Track.Source.ScreenShareAudio, 'audio')
/** The music service publishes each channel as a microphone named after the channel. */
const song = (channelId: string) => pubOf(Track.Source.Microphone, 'audio', channelId)

/** The calls a publication's subscription received, as booleans. */
const asked = (p: FakePub) => p.setSubscribed.mock.calls.map(c => c[0])

/** connect() hands the join to attemptConnect without waiting for it. */
const join = async () => {
  h.getVoiceToken.mockResolvedValue({ token: 't', url: 'wss://sfu.test', voiceServer: null, voiceActivity: true })
  await useVoice().connect('c1', 'channel', 'Lounge')
  await vi.waitFor(() => expect(voice.connected).toBe(true))
  return h.rooms.at(-1)!
}

beforeEach(() => {
  h.rooms.length = 0
  h.seed = () => ({})
  h.onConnected = null
  h.getVoiceToken.mockReset()
  music.listeningTo = null
  // leave() clears it too, and one test pins that; this keeps a broken
  // leave() from failing unrelated tests after it.
  joinedStreams.clear()
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(async () => {
  await useVoice().leave()
  await nextTick()
  music.listeningTo = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('connecting', () => {
  it('connects with autoSubscribe false', async () => {
    const room = await join()
    expect(room.connect).toHaveBeenCalledWith('wss://sfu.test', 't', expect.objectContaining({ autoSubscribe: false }))
  })

  it('on Connected, existing mic/camera are subscribed and an existing music track is not', async () => {
    const m = mic(), c = camera(), s = song('chanA')
    h.seed = () => ({ u1: [m, c], [MUSIC_IDENTITY]: [s] })
    // Read at the moment Connected has been handled, before connect resolves
    // and before getRoom() is set — the window the old sweep fell into.
    let atConnected: boolean[] = []
    h.onConnected = () => { atConnected = [m.isDesired, c.isDesired, s.isDesired] }

    await join()

    expect(atConnected).toEqual([true, true, false])
    expect([m.isDesired, c.isDesired, s.isDesired]).toEqual([true, true, false])
  })

  it('joining a call with music playing hears nothing until Listen (no subscribe ever sent for it)', async () => {
    const s = song('chanA')
    h.seed = () => ({ u1: [mic()], [MUSIC_IDENTITY]: [s] })
    const room = await join()

    // Everything else that happens early in a call sweeps the room again.
    room.arrive('u2', [mic()])
    room.publish('u1', camera())
    joinedStreams.add('u2')
    await nextTick()

    expect(s.isDesired).toBe(false)
    expect(asked(s)).not.toContain(true)

    listenToMusic('chanA')
    await nextTick()

    expect(s.isDesired).toBe(true)
    expect(asked(s)).toEqual([true])
  })

  it('a tune-in that lands while the room is still connecting is not lost', async () => {
    // Between Connected and setRoom the watchers cannot see the room yet. A
    // listen landing in that window must still be applied once it can.
    const s = song('chanA')
    h.seed = () => ({ [MUSIC_IDENTITY]: [s] })
    h.onConnected = () => { music.listeningTo = 'chanA' }

    await join()
    await nextTick()

    expect(s.isDesired).toBe(true)
  })
})

describe('mic and camera, every way they arrive', () => {
  it('a later TrackPublished mic is subscribed', async () => {
    h.seed = () => ({ u1: [] })
    const room = await join()
    const m = mic()

    room.publish('u1', m)

    expect(m.isDesired).toBe(true)
    expect(asked(m)).toEqual([true])
  })

  it('a camera turned on later is subscribed', async () => {
    h.seed = () => ({ u1: [mic()] })
    const room = await join()
    const c = camera()

    room.publish('u1', c)

    expect(c.isDesired).toBe(true)
  })

  it('someone who joins after you is heard, announced the way LiveKit does it', async () => {
    // LiveKit 2.20: ParticipantConnected for an empty participant, then a
    // TrackPublished per track from their first update.
    const room = await join()
    room.arrive('u2', [])
    const m = mic(), c = camera()

    room.publish('u2', m)
    room.publish('u2', c)

    expect([m.isDesired, c.isDesired]).toEqual([true, true])
  })

  it('someone who joins after you is heard, even when their tracks come with the join', async () => {
    // The stricter order: tracks already on the participant and no
    // TrackPublished at all, which LiveKit's own source comment still claims
    // and older versions did. The arrival sweep alone must be enough.
    const room = await join()
    const m = mic(), c = camera()

    room.arrive('u2', [m, c])

    expect([m.isDesired, c.isDesired]).toEqual([true, true])
  })

  it('unpublish and publish again: the new publication is subscribed', async () => {
    const first = mic()
    h.seed = () => ({ u1: [first] })
    const room = await join()
    expect(first.isDesired).toBe(true)

    // A device switch or a rejoin of the track: a new publication, a new sid,
    // starting unsubscribed like any other.
    room.unpublish('u1', first)
    const second = mic()
    room.publish('u1', second)

    expect(second.isDesired).toBe(true)
  })

  it('a dropped call that rejoins subscribes everyone again', async () => {
    // The app's own reconnect: Disconnected tears the room down and joins a
    // brand-new one, whose publications all start unsubscribed.
    h.seed = () => ({ u1: [mic(), camera()], [MUSIC_IDENTITY]: [song('chanA')] })
    const first = await join()

    first.emit(RoomEvent.Disconnected)
    await vi.waitFor(() => expect(h.rooms).toHaveLength(2))
    await vi.waitFor(() => expect(voice.connected).toBe(true))

    const second = h.rooms[1]
    expect(second.connect).toHaveBeenCalledWith('wss://sfu.test', 't', expect.objectContaining({ autoSubscribe: false }))
    const [m, c] = [...second.remoteParticipants.get('u1')!.trackPublications.values()]
    const [s] = [...second.remoteParticipants.get(MUSIC_IDENTITY)!.trackPublications.values()]
    expect([m.isDesired, c.isDesired, s.isDesired]).toEqual([true, true, false])
  })

  it("LiveKit's own full reconnect subscribes everyone again", async () => {
    // A full reconnect inside LiveKit (not a resume) unwinds every remote
    // participant and rebuilds them from a fresh join response, so every
    // publication is new and unsubscribed. Reconnected is emitted with the
    // room already rebuilt; it is pinned alone here, without the buffered
    // ParticipantConnected and TrackPublished events that follow it, so that
    // Reconnected by itself is enough.
    h.seed = () => ({ u1: [mic()] })
    const room = await join()
    const m = mic(), c = camera()
    room.remoteParticipants = new Map([['u1', h.person('u1', [m, c])]])

    room.emit(RoomEvent.Reconnected)

    expect([m.isDesired, c.isDesired]).toEqual([true, true])
  })

  it('nothing that happens later ever unsubscribes a mic or camera', async () => {
    const m = mic(), c = camera()
    h.seed = () => ({ u1: [m, c], [MUSIC_IDENTITY]: [song('chanA')] })
    const room = await join()

    listenToMusic('chanA'); await nextTick()
    listenToMusic(null); await nextTick()
    joinedStreams.add('u1'); await nextTick()
    joinedStreams.delete('u1'); await nextTick()
    room.arrive('u2', [mic()])
    room.publish('u1', screen())
    // Camera off is a mute, not an unpublish; it must not reach subscription.
    room.emit(RoomEvent.TrackMuted, c, room.remoteParticipants.get('u1'))
    room.emit(RoomEvent.TrackUnmuted, c, room.remoteParticipants.get('u1'))
    room.emit(RoomEvent.Reconnected)

    // Asked once, at Connected, and never again: every later sweep found
    // them already where the policy wants them.
    expect(asked(m)).toEqual([true])
    expect(asked(c)).toEqual([true])
  })
})

describe('music', () => {
  it('tuning in subscribes that music track and drops the others', async () => {
    const a = song('chanA'), b = song('chanB')
    h.seed = () => ({ [MUSIC_IDENTITY]: [a, b] })
    await join()

    listenToMusic('chanA')
    await nextTick()
    expect([a.isDesired, b.isDesired]).toEqual([true, false])

    listenToMusic('chanB')
    await nextTick()
    expect([a.isDesired, b.isDesired]).toEqual([false, true])

    listenToMusic(null)
    await nextTick()
    expect([a.isDesired, b.isDesired]).toEqual([false, false])
  })

  it('a channel someone starts mid-call stays silent for everyone not tuned in', async () => {
    h.seed = () => ({ [MUSIC_IDENTITY]: [] })
    const room = await join()
    const s = song('chanNew')

    room.publish(MUSIC_IDENTITY, s)

    expect(s.isDesired).toBe(false)
    expect(asked(s)).not.toContain(true)
  })

  it('whoever starts a channel hears it, whether its state or its track arrives first', async () => {
    // createMusicChannel(thenListen) moves the starter's ear once the
    // server's state names the new channel. The service publishes the track
    // on its own clock, so either can land first.
    h.seed = () => ({ [MUSIC_IDENTITY]: [] })
    const room = await join()
    const channel = (id: string) => ({ id, name: id, now: null, queue: [], queued: 0, listeners: [], previous: false })

    // State first, track second.
    createMusicChannel('Mix', { trackId: 't1' })
    onMusicState({ channels: [channel('chanA')] })
    await nextTick()
    const a = song('chanA')
    room.publish(MUSIC_IDENTITY, a)
    expect(a.isDesired).toBe(true)

    // Track first, state second.
    createMusicChannel('Mix 2', { trackId: 't2' })
    const b = song('chanB')
    room.publish(MUSIC_IDENTITY, b)
    expect(b.isDesired).toBe(false)
    onMusicState({ channels: [channel('chanA'), channel('chanB')] })
    await nextTick()
    expect([a.isDesired, b.isDesired]).toEqual([false, true])
  })

  it('whoever shares a song to a channel hears that channel', async () => {
    const s = song('chanA')
    h.seed = () => ({ [MUSIC_IDENTITY]: [s] })
    await join()

    shareToChannel('chanA', 'trk1')
    await nextTick()

    expect(s.isDesired).toBe(true)
  })

  it('the music service arriving after you brings no song with it', async () => {
    const room = await join()
    const s = song('chanA')

    room.arrive(MUSIC_IDENTITY, [s])

    expect(s.isDesired).toBe(false)
  })
})

describe('screen share', () => {
  it('is not subscribed until Join stream, and Join takes the picture and its sound together', async () => {
    const v = screen(), a = screenAudio(), m = mic()
    h.seed = () => ({ u1: [m, v, a] })
    await join()
    expect([v.isDesired, a.isDesired]).toEqual([false, false])

    joinedStreams.add('u1')
    await nextTick()
    expect([v.isDesired, a.isDesired]).toEqual([true, true])

    joinedStreams.delete('u1')
    await nextTick()
    expect([v.isDesired, a.isDesired]).toEqual([false, false])
    // Leaving the stream is not leaving the person.
    expect(m.isDesired).toBe(true)
  })

  it('a share started after you joined their stream is subscribed when it is published', async () => {
    h.seed = () => ({ u1: [mic()] })
    const room = await join()
    joinedStreams.add('u1')
    await nextTick()
    const v = screen()

    room.publish('u1', v)

    expect(v.isDesired).toBe(true)
  })

  it('leaving the call forgets every joined stream', async () => {
    await join()
    joinedStreams.add('u1')

    await useVoice().leave()

    expect(joinedStreams.size).toBe(0)
  })

  it('an unjoined screen share is not asked for a video quality', async () => {
    // LiveKit refuses track settings on a publication nobody asked for, and
    // logs a warning every time it is tried.
    const c = camera(), v = screen()
    h.seed = () => ({ u1: [c, v] })
    await join()
    const before = perf.incomingVideo

    perf.incomingVideo = '360p'
    await nextTick()

    expect(c.setVideoQuality).toHaveBeenCalled()
    expect(v.setVideoQuality).not.toHaveBeenCalled()
    perf.incomingVideo = before
    await nextTick()
  })
})
