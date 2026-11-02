/**
 * A shared screen's sound, and joining a stream at all.
 *
 * Before this, screen-share audio went through the same element rules as the
 * sharer's voice: their User Volume scaled it and muting them silenced it. So
 * turning down someone's game to hear them talk turned down them, and muting
 * a loud talker silenced the film they were showing. The stream now has its
 * own element rules and its own stored volume (spec 12): User Volume and the
 * local Mute leave it alone, and only Deafen — "I hear nothing" — reaches it.
 *
 * Joining is a choice for one share, not for one person (spec 18). A share
 * that stops and starts again is a new share and asks again — including when
 * it stopped and started while this member's own connection was down, which
 * no event reports: the rejoined room simply holds a different publication.
 *
 * The real useVoice runs against a fake LiveKit room, as in
 * voiceSubscriptions.test.ts. Its audio elements throw on a volume outside
 * 0..1, as the DOM's do, so no path here can set one the browser would refuse.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

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

/** An <audio> element as far as useVoice touches one. */
interface FakeEl {
  volume: number
  muted: boolean
  autoplay: boolean
  style: Record<string, string>
  inDom: boolean
  remove: ReturnType<typeof vi.fn>
  /** As livekit's attachToElement leaves it: a stream holding the remote track. */
  srcObject: { getAudioTracks: () => Array<{ id: string; kind: string }> }
}
interface FakeTrack {
  kind: 'audio' | 'video'
  sid: string
  source: string
  el: FakeEl
  attach: () => FakeEl
  detach: () => FakeEl[]
}
interface FakePub {
  trackSid: string
  source: string
  kind: 'audio' | 'video'
  trackName: string
  desired: boolean
  track?: FakeTrack
  /** Set while subscribed: the media ending, as the SFU dropping it after
   *  `setSubscribed(false)` ends it (RemoteTrackPublication.handleEnded). */
  ended?: () => void
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
  remoteParticipants: Map<string, FakePerson>
  emit: (event: string, ...args: unknown[]) => void
  publish: (identity: string, pub: FakePub) => void
  unpublish: (identity: string, pub: FakePub) => void
  subscribe: (identity: string, pub: FakePub) => FakeEl
  unsubscribe: (identity: string, pub: FakePub) => void
  leave: (identity: string) => void
  vanish: (identity: string) => void
}

const h = vi.hoisted(() => ({
  getVoiceToken: vi.fn(),
  rooms: [] as FakeRoomShape[],
  seed: (() => ({})) as () => Record<string, FakePub[]>,
  person: null as unknown as (identity: string, pubs: FakePub[]) => FakePerson,
  /** Held open, the connect waits here before the room is there and Connected fires. */
  gate: null as Promise<void> | null,
}))

vi.mock('../useApi', () => ({
  useApi: () => ({ getVoiceToken: h.getVoiceToken, moveVoiceCall: vi.fn() }),
}))

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

  const fakeTrack = (pub: FakePub): FakeTrack => {
    let volume = 1
    const el: FakeEl = {
      get volume() { return volume },
      // As HTMLMediaElement: anything outside 0..1 is an IndexSizeError.
      set volume(v: number) {
        if (!(v >= 0 && v <= 1)) throw new RangeError(`volume ${v} is outside [0, 1]`)
        volume = v
      },
      muted: false, autoplay: false, style: {}, inDom: false,
      remove: vi.fn(() => { el.inDom = false }),
      srcObject: { getAudioTracks: () => (pub.kind === 'audio' ? [mediaTrack] : []) },
    }
    const mediaTrack = { id: pub.trackSid, kind: 'audio' }
    // As Track.attach/detach: detach() hands back what is attached and
    // forgets it, so a second detach() returns nothing — which is what the
    // app's own detach gets, because the SDK detaches first (see unsubscribe).
    let attached: FakeEl[] = []
    return {
      kind: pub.kind, sid: pub.trackSid, source: pub.source, el,
      attach: () => { if (!attached.includes(el)) attached.push(el); return el },
      detach: () => { const out = attached; attached = []; return out },
    }
  }

  class FakeRoom implements FakeRoomShape {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
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
    private created(pub: FakePub) { pub.desired = this.autoSubscribe }

    connect = vi.fn(async (_url: string, _token: string, opts?: { autoSubscribe?: boolean }) => {
      if (h.gate) await h.gate
      this.autoSubscribe = opts?.autoSubscribe ?? true
      for (const [identity, pubs] of Object.entries(h.seed())) {
        pubs.forEach(p => this.created(p))
        this.remoteParticipants.set(identity, h.person(identity, pubs))
      }
      this.emit(RoomEvent.Connected)
    })
    disconnect = vi.fn(async () => {})

    publish(identity: string, pub: FakePub) {
      const p = this.remoteParticipants.get(identity)!
      this.created(pub)
      p.trackPublications.set(pub.trackSid, pub)
      this.emit(RoomEvent.TrackPublished, pub, p)
    }
    /** As RemoteParticipant.unpublishTrack: unsubscribed first, removed, then announced. */
    unpublish(identity: string, pub: FakePub) {
      const p = this.remoteParticipants.get(identity)!
      this.drop(p, pub)
    }
    /** The media for a publication this member asked for has arrived. Returns its element. */
    subscribe(identity: string, pub: FakePub): FakeEl {
      const p = this.remoteParticipants.get(identity)!
      pub.track = fakeTrack(pub)
      pub.ended = () => this.unsubscribeOf(p, pub)
      this.emit(RoomEvent.TrackSubscribed, pub.track, pub, p)
      return pub.track.el
    }
    unsubscribe(identity: string, pub: FakePub) {
      this.unsubscribeOf(this.remoteParticipants.get(identity)!, pub)
    }
    /**
     * As RemoteTrackPublication.setTrack(undefined) in livekit-client 2.20:
     * the SDK detaches the track's elements FIRST, then emits Unsubscribed.
     * So by the time TrackUnsubscribed arrives, track.detach() returns [].
     */
    private unsubscribeOf(p: FakePerson, pub: FakePub) {
      const track = pub.track
      if (!track) return
      track.detach()
      pub.track = undefined
      pub.ended = undefined
      this.emit(RoomEvent.TrackUnsubscribed, track, pub, p)
    }
    private drop(p: FakePerson, pub: FakePub) {
      this.unsubscribeOf(p, pub)
      p.trackPublications.delete(pub.trackSid)
      this.emit(RoomEvent.TrackUnpublished, pub, p)
    }
    /**
     * Someone leaves, as Room.handleParticipantDisconnected does it: out of
     * the room first, then each track unsubscribed and unpublished, then
     * ParticipantDisconnected.
     */
    leave(identity: string) {
      const p = this.remoteParticipants.get(identity)!
      this.remoteParticipants.delete(identity)
      for (const pub of [...p.trackPublications.values()]) this.drop(p, pub)
      this.emit(RoomEvent.ParticipantDisconnected, p)
    }
    /** An abrupt drop: the participant is gone and nothing was unsubscribed first. */
    vanish(identity: string) {
      const p = this.remoteParticipants.get(identity)!
      this.remoteParticipants.delete(identity)
      this.emit(RoomEvent.ParticipantDisconnected, p)
    }
  }
  return { ...real, Room: FakeRoom }
})

let Track: typeof import('livekit-client').Track
let RoomEvent: typeof import('livekit-client').RoomEvent
let nextTick: typeof import('vue').nextTick
let V: typeof import('../useVoice')
let media: typeof import('../useVoiceMedia').media
let music: typeof import('../useMusic').music
let MUSIC_IDENTITY: string

beforeAll(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
  const inertEl = () => ({ style: {}, setAttribute() {}, removeAttribute() {} })
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
    body: {
      appendChild: (el: FakeEl) => { el.inDom = true; return el },
      contains: (el: FakeEl) => el.inDom,
    },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Document
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia

  ;({ Track, RoomEvent } = await import('livekit-client'))
  ;({ nextTick } = await import('vue'))
  V = await import('../useVoice')
  ;({ media } = await import('../useVoiceMedia'))
  ;({ music, MUSIC_IDENTITY } = await import('../useMusic'))
})

let sid = 0
const pubOf = (source: string, kind: 'audio' | 'video', trackSid = `TR_${++sid}`): FakePub => {
  const p: FakePub = {
    trackSid, source, kind, trackName: '',
    desired: false,
    get isDesired() { return p.desired },
    // Saying no to a subscribed track ends its media, which unsubscribes it.
    setSubscribed: vi.fn((on: boolean) => { p.desired = on; if (!on) p.ended?.() }),
    setVideoQuality: vi.fn(),
    setEnabled: vi.fn(),
  }
  return p
}
const mic = (trackSid?: string) => pubOf(Track.Source.Microphone, 'audio', trackSid)
const screen = (trackSid?: string) => pubOf(Track.Source.ScreenShare, 'video', trackSid)
const screenAudio = (trackSid?: string) => pubOf(Track.Source.ScreenShareAudio, 'audio', trackSid)

const asked = (p: FakePub) => p.setSubscribed.mock.calls.map(c => c[0])

const join = async () => {
  h.getVoiceToken.mockResolvedValue({ token: 't', url: 'wss://sfu.test', voiceServer: null, voiceActivity: true })
  await V.useVoice().connect('c1', 'channel', 'Lounge')
  await vi.waitFor(() => expect(V.voice.connected).toBe(true))
  return h.rooms.at(-1)!
}

/** u1 in the call, talking and sharing a screen with sound; we joined their stream. */
const watchingU1 = async () => {
  const m = mic(), v = screen(), a = screenAudio()
  h.seed = () => ({ u1: [m, v, a] })
  const room = await join()
  V.joinStream('u1')
  await nextTick()
  return { room, m, v, a, voiceEl: room.subscribe('u1', m), streamEl: room.subscribe('u1', a) }
}

beforeEach(() => {
  h.rooms.length = 0
  h.gate = null
  h.seed = () => ({})
  h.getVoiceToken.mockReset()
  for (const id of Object.keys(V.userPrefs)) delete V.userPrefs[id]
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(async () => {
  await V.useVoice().leave()
  music.listeningTo = null
  await nextTick()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('stream audio has its own element rules', () => {
  it('screen audio uses streamVolume, not User Volume', async () => {
    const { voiceEl, streamEl } = await watchingU1()
    expect(V.streamVolumeOf('u1')).toBe(100)
    expect(streamEl.volume).toBe(1)

    V.setUserPref('u1', { volume: 40 })
    expect(voiceEl.volume).toBeCloseTo(0.4)
    expect(streamEl.volume).toBe(1)

    V.setStreamVolume('u1', 25)
    expect(streamEl.volume).toBeCloseTo(0.25)
    expect(voiceEl.volume).toBeCloseTo(0.4)
    expect(V.streamVolumeOf('u1')).toBe(25)
    // Stored next to User Volume, per person.
    expect(V.userPref('u1')).toMatchObject({ volume: 40, streamVolume: 25 })
  })

  it('Stream Volume runs 0–100 and only ever turns the stream down', async () => {
    const { streamEl } = await watchingU1()

    V.setStreamVolume('u1', 180)
    expect(V.streamVolumeOf('u1')).toBe(100)
    expect(streamEl.volume).toBe(1)

    V.setStreamVolume('u1', -5)
    expect(V.streamVolumeOf('u1')).toBe(0)
    expect(streamEl.volume).toBe(0)

    V.setStreamVolume('u1', 33.6)
    expect(V.streamVolumeOf('u1')).toBe(34)
  })

  it('the output volume scales the stream as it scales every voice', async () => {
    const { voiceEl, streamEl } = await watchingU1()
    const { voiceSettings } = await import('../useVoiceSettings')
    const before = voiceSettings.outputVolume
    V.setStreamVolume('u1', 50)

    voiceSettings.outputVolume = 50
    V.useVoice().applyOutput()

    expect(voiceEl.volume).toBeCloseTo(0.5)
    expect(streamEl.volume).toBeCloseTo(0.25)
    voiceSettings.outputVolume = before
  })

  it('local Mute silences the voice but not the stream', async () => {
    const { voiceEl, streamEl } = await watchingU1()

    V.setUserPref('u1', { muted: true })

    expect(voiceEl.muted).toBe(true)
    expect(streamEl.muted).toBe(false)
  })

  it('unmuting while deafened undeafens, and you hear the call again', async () => {
    const { voiceEl, streamEl } = await watchingU1()
    V.useVoice().toggleDeafen()
    expect(voiceEl.muted).toBe(true)
    expect(streamEl.muted).toBe(true)

    V.useVoice().toggleMute()
    expect(V.voice.localDeafened).toBe(false)
    expect(voiceEl.muted).toBe(false)
    expect(streamEl.muted).toBe(false)
  })

  it('deafen silences the stream', async () => {
    const { room, voiceEl, streamEl } = await watchingU1()
    V.setUserPref('u1', { muted: true })

    V.useVoice().toggleDeafen()
    expect(streamEl.muted).toBe(true)
    expect(voiceEl.muted).toBe(true)

    // A stream that arrives while deafened starts silent too.
    const late = screenAudio()
    room.publish('u1', late)
    const lateEl = room.subscribe('u1', late)
    expect(lateEl.muted).toBe(true)

    V.useVoice().toggleDeafen()
    expect(streamEl.muted).toBe(false)
    expect(lateEl.muted).toBe(false)
    // Undeafening is not a blanket unmute: the person you muted stays muted.
    expect(voiceEl.muted).toBe(true)
  })
})

describe('joining a stream', () => {
  it('Join stream loads the picture and its sound; Leave stream stops loading both, not the person', async () => {
    const m = mic(), v = screen(), a = screenAudio()
    h.seed = () => ({ u1: [m, v, a] })
    await join()
    expect([v.isDesired, a.isDesired]).toEqual([false, false])

    V.joinStream('u1')
    await nextTick()
    expect([v.isDesired, a.isDesired]).toEqual([true, true])
    expect(V.joinedStreams.has('u1')).toBe(true)

    V.leaveStream('u1')
    await nextTick()
    expect([v.isDesired, a.isDesired]).toEqual([false, false])
    expect(V.joinedStreams.has('u1')).toBe(false)
    expect(m.isDesired).toBe(true)
  })

  it('the stream joined last is your choice: another join replaces it; leaving it, its share ending, or leaving the call clears it', async () => {
    const v = screen(), a = screenAudio()
    h.seed = () => ({ u1: [mic(), v, a], u2: [mic(), screen()] })
    const room = await join()
    expect(V.chosenStream.value).toBeNull()
    V.joinStream('u1')
    expect(V.chosenStream.value).toBe('u1')

    // Joining another is a new choice. Leaving one you did not choose keeps it.
    V.joinStream('u2')
    expect(V.chosenStream.value).toBe('u2')
    V.leaveStream('u1')
    expect(V.chosenStream.value).toBe('u2')

    // Leaving the chosen one clears it; nothing older is promoted in its place.
    V.joinStream('u1')
    V.leaveStream('u1')
    expect(V.chosenStream.value).toBeNull()

    // Its share ending clears it too (forgetEndedShares leaves it).
    V.joinStream('u1')
    expect(V.chosenStream.value).toBe('u1')
    room.unpublish('u1', v)
    room.unpublish('u1', a)
    expect(V.chosenStream.value).toBeNull()

    // And the call ending.
    V.joinStream('u2')
    await V.useVoice().leave()
    expect(V.chosenStream.value).toBeNull()
  })

  it('a share that stops clears its joined state; a new share asks again', async () => {
    const { room, v, a } = await watchingU1()
    expect([v.isDesired, a.isDesired]).toEqual([true, true])

    room.unpublish('u1', v)
    room.unpublish('u1', a)
    expect(V.joinedStreams.has('u1')).toBe(false)

    const v2 = screen(), a2 = screenAudio()
    room.publish('u1', v2)
    room.publish('u1', a2)
    await nextTick()

    expect([v2.isDesired, a2.isDesired]).toEqual([false, false])
    expect(asked(v2)).not.toContain(true)
    expect(asked(a2)).not.toContain(true)
  })

  it('a share that stopped and started again while your connection was down asks again', async () => {
    h.seed = () => ({ u1: [mic('M1'), screen('S1'), screenAudio('A1')] })
    const first = await join()
    V.joinStream('u1')
    await nextTick()

    // While we are away, u1 stops sharing and shares again: a new publication,
    // a new sid. Nothing tells us — the rejoined room just holds it.
    let v2!: FakePub, a2!: FakePub
    h.seed = () => ({ u1: [mic('M1'), (v2 = screen('S2')), (a2 = screenAudio('A2'))] })
    first.emit(RoomEvent.Disconnected)
    await vi.waitFor(() => expect(h.rooms).toHaveLength(2))
    await vi.waitFor(() => expect(V.voice.connected).toBe(true))
    await nextTick()

    expect([v2.isDesired, a2.isDesired]).toEqual([false, false])
    expect(asked(v2)).not.toContain(true)
    expect(V.joinedStreams.has('u1')).toBe(false)
  })

  it('a share still running when your connection comes back stays joined', async () => {
    // The other side of the same rule: a dropped connection is still the same
    // call (Task 1), and the same share is still the stream you chose.
    h.seed = () => ({ u1: [mic('M1'), screen('S1'), screenAudio('A1')] })
    const first = await join()
    V.joinStream('u1')
    await nextTick()

    first.emit(RoomEvent.Disconnected)
    await vi.waitFor(() => expect(h.rooms).toHaveLength(2))
    await vi.waitFor(() => expect(V.voice.connected).toBe(true))
    await nextTick()

    const pubs = [...h.rooms[1].remoteParticipants.get('u1')!.trackPublications.values()]
    expect(pubs.map(p => p.isDesired)).toEqual([true, true, true])
    expect(V.joinedStreams.has('u1')).toBe(true)
  })

  it("LiveKit's own full reconnect does not forget a stream you joined", async () => {
    // A restart inside LiveKit removes every participant — TrackUnpublished
    // for each track, then ParticipantDisconnected — and rebuilds them with
    // the server's same publications before Reconnected.
    const { room } = await watchingU1()
    const u1 = room.remoteParticipants.get('u1')!
    const sids = [...u1.trackPublications.values()].map(p => [p.trackSid, p.source] as const)
    room.remoteParticipants.delete('u1')
    for (const p of [...u1.trackPublications.values()]) {
      u1.trackPublications.delete(p.trackSid)
      room.emit(RoomEvent.TrackUnpublished, p, u1)
    }
    room.emit(RoomEvent.ParticipantDisconnected, u1)
    await nextTick()

    const rebuilt = sids.map(([s, source]) =>
      pubOf(source, source === Track.Source.ScreenShare ? 'video' : 'audio', s))
    room.remoteParticipants.set('u1', h.person('u1', rebuilt))
    room.emit(RoomEvent.Reconnected)
    await nextTick()

    expect(rebuilt.map(p => p.isDesired)).toEqual([true, true, true])
    expect(V.joinedStreams.has('u1')).toBe(true)
  })

  it('a sharer leaving removes the stream element', async () => {
    const { room, streamEl, voiceEl } = await watchingU1()
    expect(streamEl.inDom).toBe(true)

    // Abruptly: no TrackUnsubscribed first, the drop the video purge exists for.
    room.vanish('u1')

    expect(streamEl.remove).toHaveBeenCalled()
    expect(streamEl.inDom).toBe(false)
    expect(voiceEl.inDom).toBe(false)
    // Nothing still manages it: a later volume change cannot reach it.
    V.setStreamVolume('u1', 10)
    expect(streamEl.volume).toBe(1)
    expect(V.debugAudio().audioElements).toEqual([])
    expect(media.streamsAvailable.has('u1')).toBe(false)
  })
})

describe('media.streamsAvailable', () => {
  it('a connect cancelled before it lands leaves nobody sharing', async () => {
    h.seed = () => ({ u1: [mic(), screen()] })
    let open!: () => void
    h.gate = new Promise<void>(r => { open = r })
    h.getVoiceToken.mockResolvedValue({ token: 't', url: 'wss://sfu.test', voiceServer: null, voiceActivity: true })
    const going = V.useVoice().connect('c1', 'channel', 'Lounge')
    await vi.waitFor(() => expect(h.rooms).toHaveLength(1))
    // Cancel while LiveKit is still connecting; then it lands, and fires Connected.
    await V.useVoice().leave()
    open()
    await going
    await vi.waitFor(() => expect((h.rooms[0] as unknown as { disconnect: ReturnType<typeof vi.fn> }).disconnect).toHaveBeenCalled())
    expect(V.voice.connected).toBe(false)
    expect(media.streamsAvailable.size).toBe(0)
  })

  it('lists who is sharing a screen, joined or not, and who shares one with sound', async () => {
    const v1 = screen()
    h.seed = () => ({ u1: [mic(), v1], u2: [mic()] })
    const room = await join()
    expect([...media.streamsAvailable]).toEqual(['u1'])
    expect([...media.streamsWithAudio]).toEqual([])

    room.publish('u2', screen())
    room.publish('u2', screenAudio())
    expect(new Set(media.streamsAvailable)).toEqual(new Set(['u1', 'u2']))
    expect([...media.streamsWithAudio]).toEqual(['u2'])

    room.unpublish('u1', v1)
    expect([...media.streamsAvailable]).toEqual(['u2'])

    await V.useVoice().leave()
    expect(media.streamsAvailable.size).toBe(0)
    expect(media.streamsWithAudio.size).toBe(0)
  })
})

/*
 * An unsubscribed track's <audio> leaves the page.
 *
 * livekit-client 2.20 detaches a track's elements itself before it emits
 * Unsubscribed (RemoteTrackPublication.setTrack(undefined)), so the app's
 * `track.detach()` gets back nothing and removing what it returns removed
 * nothing: every Leave stream, every sharer leaving and every voice gone left
 * a hidden element in the body. The fake above detaches in that order.
 */
describe('an unsubscribed track takes its element with it', () => {
  it('Leave stream then TrackUnsubscribed takes the stream element out of the DOM', async () => {
    const { voiceEl, streamEl } = await watchingU1()
    expect(streamEl.inDom).toBe(true)

    // Leave stream → the sweep says no → the SDK drops the track.
    V.leaveStream('u1')
    await nextTick()

    expect(streamEl.inDom).toBe(false)
    expect(voiceEl.inDom).toBe(true)
    expect(V.debugAudio().audioElements.map(e => e.kind)).toEqual(['voice'])
  })

  it('a sharer leaving (Unsubscribed first, as the SDK does) removes the stream element', async () => {
    const { room, voiceEl, streamEl } = await watchingU1()

    room.leave('u1')

    expect(streamEl.inDom).toBe(false)
    expect(voiceEl.inDom).toBe(false)
    expect(V.debugAudio().audioElements).toEqual([])
    expect(media.streamsAvailable.has('u1')).toBe(false)
  })

  it('a voice unsubscribed after the SDK detached it takes its element out of the DOM', async () => {
    // A mic switched or republished: the old publication goes, Unsubscribed first.
    const { room, m, voiceEl, streamEl } = await watchingU1()

    room.unpublish('u1', m)

    expect(voiceEl.inDom).toBe(false)
    expect(streamEl.inDom).toBe(true)
    expect(V.debugAudio().audioElements.map(e => e.kind)).toEqual(['stream'])
  })

  it('music you tune out of takes its element out of the DOM', async () => {
    const song = pubOf(Track.Source.Microphone, 'audio')
    song.trackName = 'chanA'
    h.seed = () => ({ [MUSIC_IDENTITY]: [song] })
    const room = await join()
    music.listeningTo = 'chanA'
    await nextTick()
    const el = room.subscribe(MUSIC_IDENTITY, song)
    expect(el.inDom).toBe(true)

    music.listeningTo = null
    await nextTick()

    expect(song.isDesired).toBe(false)
    expect(el.inDom).toBe(false)
  })
})

/*
 * User Volume above 100 % (spec 12).
 *
 * The element throws past a volume of 1, so before this a voice turned up
 * to 150 % threw out of every volume change — and out of LiveKit's
 * TrackSubscribed when it arrived already turned up, so it was never kept
 * and nothing applied to it again. Past what the element can play, a voice
 * now goes through a shared Web Audio gain stage (remoteGain.ts); a shared
 * screen's sound never does — Stream Volume stops at 100.
 *
 * The stage's level is read through debugAudio's `stageGain`: null for an
 * element playing on its own, the gain while it is routed.
 */
class FakeAudioContext {
  static made: FakeAudioContext[] = []
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  onstatechange: (() => void) | null = null
  nodes: Array<{ disconnect: ReturnType<typeof vi.fn> }> = []
  constructor() { FakeAudioContext.made.push(this) }
  private to(s: AudioContextState) { this.state = s; this.onstatechange?.() }
  // As the real one: `state` changes once the request settles, in order.
  resume = vi.fn(async () => { await null; this.to('running') })
  suspend = vi.fn(async () => { await null; this.to('suspended') })
  private node<T extends object>(extra: T) {
    const n = { connect: vi.fn((x: unknown) => x), disconnect: vi.fn(), ...extra }
    this.nodes.push(n)
    return n
  }
  createMediaStreamSource = vi.fn(() => this.node({}))
  createGain = vi.fn(() => {
    const g = this.node({ gain: { value: 1, setTargetAtTime: (v: number) => { g.gain.value = v } } })
    return g
  })
}
/** A browser whose AudioContext can follow a chosen output device. */
class SinkAudioContext extends FakeAudioContext {}
;(SinkAudioContext.prototype as unknown as { setSinkId: unknown }).setSinkId = vi.fn(async () => {})

/** The stage gain debugAudio reports for this element's track. */
const stageOf = (el: FakeEl) => {
  const sid = el.srcObject.getAudioTracks()[0]?.id
  return V.debugAudio().audioElements.find(e => e.sid === sid)?.stageGain
}

describe('User Volume above 100 %', () => {
  it('applyAudioEl at 150 % does not throw', async () => {
    const m = mic()
    h.seed = () => ({ u1: [m] })
    const room = await join()
    const voiceEl = room.subscribe('u1', m)

    expect(() => V.setUserPref('u1', { volume: 150 })).not.toThrow()
    expect(voiceEl.volume).toBe(1)

    // A voice that arrives already turned up: attaching it must not throw out
    // of LiveKit's TrackSubscribed either, and the element must still be kept.
    const m2 = mic()
    room.publish('u1', m2)
    let lateEl!: FakeEl
    expect(() => { lateEl = room.subscribe('u1', m2) }).not.toThrow()
    expect(lateEl.inDom).toBe(true)
    // So turning them down and muting them reaches it again.
    V.setUserPref('u1', { volume: 50, muted: true })
    expect(lateEl.volume).toBeCloseTo(0.5)
    expect(lateEl.muted).toBe(true)
  })

  it('with no Web Audio there is nothing to amplify with: the slider stops at 100', () => {
    expect(V.userVolumeMax()).toBe(100)
  })

  describe('with Web Audio', () => {
    beforeEach(() => { vi.stubGlobal('AudioContext', SinkAudioContext) })

    it('past 100 % the voice is amplified through the stage; the stream is not', async () => {
      const { voiceEl, streamEl } = await watchingU1()
      expect(V.userVolumeMax()).toBe(200)

      V.setUserPref('u1', { volume: 150 })
      expect(stageOf(voiceEl)).toBe(1.5)
      // Playing, so Chromium keeps feeding the stage, but heard through it only.
      expect(voiceEl.muted).toBe(true)
      expect(streamEl.muted).toBe(false)
      expect(streamEl.volume).toBe(1)
      expect(stageOf(streamEl)).toBeNull()

      // The output level multiplies it, on the stage as on the element.
      const { voiceSettings } = await import('../useVoiceSettings')
      voiceSettings.outputVolume = 80
      V.useVoice().applyOutput()
      expect(stageOf(voiceEl)).toBeCloseTo(1.2)
      voiceSettings.outputVolume = 100

      // Back under 100 %: off the stage, onto the element.
      V.setUserPref('u1', { volume: 80 })
      expect(stageOf(voiceEl)).toBeNull()
      expect(voiceEl.muted).toBe(false)
      expect(voiceEl.volume).toBeCloseTo(0.8)
    })

    it('Mute and Deafen silence an amplified voice; undeafening restores it', async () => {
      const { voiceEl, streamEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })

      // Deafen used to set `muted` on every element and nothing else — which
      // an amplified voice already is, while the stage plays it.
      V.useVoice().toggleDeafen()
      expect(stageOf(voiceEl)).toBe(0)
      expect(streamEl.muted).toBe(true)

      V.useVoice().toggleDeafen()
      expect(stageOf(voiceEl)).toBe(1.5)
      expect(streamEl.muted).toBe(false)

      V.setUserPref('u1', { muted: true })
      expect(stageOf(voiceEl)).toBe(0)
      V.setUserPref('u1', { muted: false })
      expect(stageOf(voiceEl)).toBe(1.5)
    })

    it('a voice that arrives already turned up is amplified, and kept', async () => {
      const m = mic()
      h.seed = () => ({ u1: [m] })
      const room = await join()
      V.setUserPref('u1', { volume: 175 })

      const el = room.subscribe('u1', m)
      expect(el.inDom).toBe(true)
      expect(stageOf(el)).toBe(1.75)
    })

    it('a voice leaving takes its stage with it, and leaving the call lets the context sleep', async () => {
      const { room, voiceEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })
      const ctx = FakeAudioContext.made.at(-1)!
      const live = ctx.nodes.slice(-2)

      room.leave('u1')
      expect(voiceEl.inDom).toBe(false)
      for (const n of live) expect(n.disconnect).toHaveBeenCalled()

      await V.useVoice().leave()
      expect(ctx.suspend).toHaveBeenCalled()
    })

    it('joining a call wakes the shared context', async () => {
      const { voiceEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })
      expect(stageOf(voiceEl)).toBe(1.5)
      await V.useVoice().leave()
      const ctx = FakeAudioContext.made.at(-1)!
      await vi.waitFor(() => expect(ctx.state).toBe('suspended'))
      ctx.resume.mockClear()

      await join()
      expect(ctx.resume).toHaveBeenCalled()
    })

    it('switching straight to another call leaves the stage awake for it', async () => {
      const { voiceEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })
      expect(stageOf(voiceEl)).toBe(1.5)
      const ctx = FakeAudioContext.made.at(-1)!

      // The old call's cleanup suspends the stage; the new call must not
      // inherit that. A real context settles a suspend on a later task (its
      // `state` reads "running" until then) and runs a resume after it.
      let pending: Promise<void> = Promise.resolve()
      ctx.suspend.mockImplementationOnce(() => (pending = new Promise<void>(r => setTimeout(() => {
        ctx.state = 'suspended'; ctx.onstatechange?.(); r()
      }, 5))))
      ctx.resume.mockImplementation(async () => { await pending; ctx.state = 'running'; ctx.onstatechange?.() })
      try {
        h.getVoiceToken.mockResolvedValue({ token: 't', url: 'wss://sfu.test', voiceServer: null, voiceActivity: true })
        await V.useVoice().connect('c2', 'channel', 'Other')
        await vi.waitFor(() => expect(V.voice.activeConvId).toBe('c2'))
        expect(ctx.suspend).toHaveBeenCalled()
        await pending
        await new Promise(r => setTimeout(r, 0))
        expect(ctx.state).toBe('running')
      } finally {
        ctx.resume.mockReset()
      }
    })

    it('a context that is not running leaves the voice on its element, never silent', async () => {
      const { voiceEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })
      const ctx = FakeAudioContext.made.at(-1)!

      // Suspended under us mid-call (the OS took the audio device, say), and
      // asking it to resume does not bring it back.
      ctx.resume.mockImplementation(async () => {})
      try {
        ctx.state = 'suspended'; ctx.onstatechange?.()

        expect(stageOf(voiceEl)).toBeNull()
        expect(voiceEl.muted).toBe(false)
        expect(voiceEl.volume).toBe(1)
      } finally {
        // One context for the app session, as in the app, so the tests share
        // it: leave it able to run again.
        ctx.resume.mockReset()
      }
    })

    it('a chosen output is amplified only once the context plays there', async () => {
      const { voiceSettings } = await import('../useVoiceSettings')
      const { voiceEl } = await watchingU1()
      const ctx = FakeAudioContext.made.at(-1)!
      let settle!: () => void
      const setSink = vi.fn(() => new Promise<void>(r => { settle = r }))
      ;(ctx as unknown as { setSinkId: unknown }).setSinkId = setSink
      voiceSettings.outputDeviceId = 'headset-1'
      try {
        V.setUserPref('u1', { volume: 150 })
        // On its element, at 100 %, where the element already plays — not on
        // the stage, which would still be playing to the default device.
        expect(setSink).toHaveBeenCalledWith('headset-1')
        expect(stageOf(voiceEl)).toBeNull()
        expect(voiceEl.muted).toBe(false)
        expect(voiceEl.volume).toBe(1)
        settle()
        await vi.waitFor(() => expect(stageOf(voiceEl)).toBe(1.5))
        expect(voiceEl.muted).toBe(true)
      } finally {
        voiceSettings.outputDeviceId = ''
        delete (ctx as unknown as { setSinkId?: unknown }).setSinkId
        V.useVoice().applyOutput()
      }
    })

    it('an output the context refuses caps User Volume at 100 %, and applies it again', async () => {
      const { voiceSettings } = await import('../useVoiceSettings')
      const { voiceEl } = await watchingU1()
      const ctx = FakeAudioContext.made.at(-1)!
      ;(ctx as unknown as { setSinkId: unknown }).setSinkId = vi.fn(async () => { throw new Error('NotFoundError') })
      voiceSettings.outputDeviceId = 'headset-2'
      try {
        V.setUserPref('u1', { volume: 150 })
        await vi.waitFor(() => expect(V.userVolumeMax()).toBe(100))
        expect(stageOf(voiceEl)).toBeNull()
        expect(voiceEl.muted).toBe(false)
        expect(voiceEl.volume).toBe(1)
        expect(V.userPref('u1').volume).toBe(150)
      } finally {
        voiceSettings.outputDeviceId = ''
        delete (ctx as unknown as { setSinkId?: unknown }).setSinkId
        V.useVoice().applyOutput()
      }
      expect(V.userVolumeMax()).toBe(200)
    })

    it('an output device the context cannot follow caps User Volume at 100 %', async () => {
      // Elements can pick an output; this AudioContext cannot.
      vi.stubGlobal('AudioContext', FakeAudioContext)
      vi.stubGlobal('HTMLMediaElement', class { setSinkId() {} })
      const { voiceSettings } = await import('../useVoiceSettings')
      const { voiceEl } = await watchingU1()
      V.setUserPref('u1', { volume: 150 })
      expect(stageOf(voiceEl)).toBe(1.5)   // default output: amplified

      voiceSettings.outputDeviceId = 'headset-1'
      try {
        V.useVoice().applyOutput()
        expect(V.userVolumeMax()).toBe(100)
        expect(stageOf(voiceEl)).toBeNull()
        expect(voiceEl.muted).toBe(false)
        expect(voiceEl.volume).toBe(1)
        // The stored choice is kept: back on the default output, it applies again.
        expect(V.userPref('u1').volume).toBe(150)
      } finally {
        voiceSettings.outputDeviceId = ''
      }
      V.useVoice().applyOutput()
      expect(V.userVolumeMax()).toBe(200)
      expect(stageOf(voiceEl)).toBe(1.5)
    })
  })
})
