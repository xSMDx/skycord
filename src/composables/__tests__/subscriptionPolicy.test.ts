/**
 * What this member downloads from a call, decided by one rule.
 *
 * The room connects with autoSubscribe off, so nothing arrives unless this
 * policy asks for it. That is what makes it the whole voice path: a mistake
 * on the mic side is somebody nobody can hear, and a mistake on the other
 * side is a song you did not tune into or a screen you did not join, playing
 * or downloading anyway. So every kind is pinned against every context, not
 * just the one each test is named after.
 */
import { describe, it, expect, vi } from 'vitest'
import { Track, type Room } from 'livekit-client'

// subscriptionPolicy reads the music service's identity from useMusic, which
// opens a socket through useSocket at import. Same stub as musicClient.test.ts.
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit: () => {} }) }))

const { kindOf, shouldSubscribe, applySubscriptions } = await import('../subscriptionPolicy')
const { MUSIC_IDENTITY } = await import('../useMusic')

type Kind = ReturnType<typeof kindOf>
const KINDS: Kind[] = ['mic', 'camera', 'screen', 'screen-audio', 'music']

const ctx = (over: Partial<Parameters<typeof shouldSubscribe>[1]> = {}) => ({
  identity: 'u1', trackName: undefined, listeningTo: null, joinedStreams: new Set<string>(), ...over,
})

/** Every combination of "tuned into something" and "joined someone's stream" worth telling apart. */
const CONTEXTS = [
  ctx(),
  ctx({ listeningTo: 'chanA' }),
  ctx({ listeningTo: 'chanA', trackName: 'chanA' }),
  ctx({ listeningTo: 'chanA', trackName: 'chanB' }),
  ctx({ joinedStreams: new Set(['u1']) }),
  ctx({ joinedStreams: new Set(['u2']) }),
  ctx({ listeningTo: 'chanA', trackName: 'chanA', joinedStreams: new Set(['u1']) }),
]

describe('shouldSubscribe', () => {
  it('mic is always subscribed', () => {
    // Whatever you are tuned into and whatever stream you joined: a voice is
    // never something you opt into.
    for (const c of CONTEXTS) expect(shouldSubscribe('mic', c)).toBe(true)
  })

  it('camera is always subscribed', () => {
    for (const c of CONTEXTS) expect(shouldSubscribe('camera', c)).toBe(true)
  })

  it('music only for the channel you are tuned into', () => {
    expect(shouldSubscribe('music', ctx({ listeningTo: 'chanA', trackName: 'chanA' }))).toBe(true)
    // Tuned into another channel in the same call: not this one.
    expect(shouldSubscribe('music', ctx({ listeningTo: 'chanA', trackName: 'chanB' }))).toBe(false)
    // Tuned into nothing — the state every member arrives in.
    expect(shouldSubscribe('music', ctx({ listeningTo: null, trackName: 'chanA' }))).toBe(false)
    // A track with no name can never be "the channel you chose", even when
    // nothing is chosen either: null and undefined must not read as a match.
    expect(shouldSubscribe('music', ctx({ listeningTo: null, trackName: undefined }))).toBe(false)
    expect(shouldSubscribe('music', ctx({ listeningTo: '', trackName: '' }))).toBe(false)
    // Joining someone's stream is not tuning in.
    expect(shouldSubscribe('music', ctx({ trackName: 'chanA', joinedStreams: new Set(['u1']) }))).toBe(false)
  })

  it('a screen and its audio only after Join stream', () => {
    for (const kind of ['screen', 'screen-audio'] as const) {
      expect(shouldSubscribe(kind, ctx())).toBe(false)
      expect(shouldSubscribe(kind, ctx({ joinedStreams: new Set(['u1']) }))).toBe(true)
      // Joining one person's stream is not joining everyone's.
      expect(shouldSubscribe(kind, ctx({ joinedStreams: new Set(['u2']) }))).toBe(false)
      // Tuning into music does not pull a screen in with it.
      expect(shouldSubscribe(kind, ctx({ listeningTo: 'chanA', trackName: 'chanA' }))).toBe(false)
    }
  })

  it('every kind has an answer in every context', () => {
    // A kind the switch forgot would come back undefined, which setSubscribed
    // would read as "no" — silently, for every member.
    for (const kind of KINDS) for (const c of CONTEXTS) expect(typeof shouldSubscribe(kind, c)).toBe('boolean')
  })
})

describe('kindOf', () => {
  it('names each source a person can publish', () => {
    expect(kindOf({ source: Track.Source.Microphone }, 'u1')).toBe('mic')
    expect(kindOf({ source: Track.Source.Camera }, 'u1')).toBe('camera')
    expect(kindOf({ source: Track.Source.ScreenShare }, 'u1')).toBe('screen')
    expect(kindOf({ source: Track.Source.ScreenShareAudio }, 'u1')).toBe('screen-audio')
  })

  it("the music bot's tracks are music whatever their source", () => {
    // The service publishes as a microphone (music/src/publisher.ts). Read by
    // source alone, every channel in the call would count as a voice and be
    // subscribed for everyone — which is the bug this replaces.
    for (const source of [Track.Source.Microphone, Track.Source.Unknown, Track.Source.Camera, Track.Source.ScreenShareAudio]) {
      expect(kindOf({ source, trackName: 'chanA' }, MUSIC_IDENTITY)).toBe('music')
    }
  })

  it('an unlabelled track from a person counts as their voice', () => {
    // Nothing in Skycord publishes one, but if anything ever does, the side
    // to fail on is hearing it, not a person nobody can hear.
    expect(kindOf({ source: Track.Source.Unknown }, 'u1')).toBe('mic')
  })
})

// ── applySubscriptions ───────────────────────────────────────────────────────

/** A publication as LiveKit makes one with autoSubscribe off: not desired until asked. */
const pub = (source: Track.Source, trackName = '') => {
  const p = {
    trackSid: `TR_${source}_${trackName}_${Math.random()}`,
    source, trackName,
    desired: false,
    get isDesired() { return p.desired },
    setSubscribed: vi.fn((on: boolean) => { p.desired = on }),
  }
  return p
}
type Pub = ReturnType<typeof pub>

const roomOf = (people: Record<string, Pub[]>) => ({
  remoteParticipants: new Map(Object.entries(people).map(([identity, pubs]) => [identity, {
    identity, trackPublications: new Map(pubs.map(p => [p.trackSid, p])),
  }])),
}) as unknown as Room

describe('applySubscriptions', () => {
  it('sets every remote publication to the policy', () => {
    const mic = pub(Track.Source.Microphone), cam = pub(Track.Source.Camera)
    const screen = pub(Track.Source.ScreenShare), screenAudio = pub(Track.Source.ScreenShareAudio)
    const otherScreen = pub(Track.Source.ScreenShare)
    const a = pub(Track.Source.Microphone, 'chanA'), b = pub(Track.Source.Microphone, 'chanB')
    const room = roomOf({ u1: [mic, cam, screen, screenAudio], u2: [otherScreen], [MUSIC_IDENTITY]: [a, b] })

    applySubscriptions(room, { listeningTo: 'chanB', joinedStreams: new Set(['u1']) })

    expect([mic, cam, screen, screenAudio, b].map(p => p.isDesired)).toEqual([true, true, true, true, true])
    expect([otherScreen, a].map(p => p.isDesired)).toEqual([false, false])
  })

  it('sends nothing for a publication already where the policy wants it', () => {
    // Every event sweeps the whole room. Re-sending each answer would be a
    // signal message per publication per join; sending a "no" for a track
    // that was never asked for would be pointless traffic too.
    const mic = pub(Track.Source.Microphone), song = pub(Track.Source.Microphone, 'chanA')
    const room = roomOf({ u1: [mic], [MUSIC_IDENTITY]: [song] })
    const none = { listeningTo: null, joinedStreams: new Set<string>() }

    applySubscriptions(room, none)
    applySubscriptions(room, none)

    expect(mic.setSubscribed.mock.calls).toEqual([[true]])
    expect(song.setSubscribed).not.toHaveBeenCalled()
  })

  it('takes back what the policy no longer wants', () => {
    const song = pub(Track.Source.Microphone, 'chanA'), screen = pub(Track.Source.ScreenShare)
    const room = roomOf({ u1: [screen], [MUSIC_IDENTITY]: [song] })

    applySubscriptions(room, { listeningTo: 'chanA', joinedStreams: new Set(['u1']) })
    applySubscriptions(room, { listeningTo: null, joinedStreams: new Set() })

    expect(song.setSubscribed.mock.calls).toEqual([[true], [false]])
    expect(screen.setSubscribed.mock.calls).toEqual([[true], [false]])
  })

  it('an empty room is a no-op', () => {
    expect(() => applySubscriptions(roomOf({}), { listeningTo: 'x', joinedStreams: new Set() })).not.toThrow()
  })
})
