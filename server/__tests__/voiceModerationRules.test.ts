import { describe, expect, it } from 'vitest'
import { TrackSource } from 'livekit-server-sdk'
import {
  canPublishUnder, canSubscribeUnder, adminUrl, NO_RESTRICTION,
  publishGrantFor, UNRESTRICTED_PERMITS,
} from '../utils/voiceModeration'

/**
 * The pure half of voice moderation: what a restriction MEANS.
 *
 * Deliberately in its own file with no `connectDb`. These rules decide whether
 * somebody's microphone works, and needing a database running to check them
 * would mean they go unverified on any machine where Mongo is not up — which is
 * exactly when a regression would slip through. The endpoint behaviour that
 * genuinely needs a database lives in voiceModeration.test.ts.
 */

describe('what a restriction permits', () => {
  it('leaves an unrestricted member alone', () => {
    expect(canPublishUnder(NO_RESTRICTION)).toBe(true)
    expect(canSubscribeUnder(NO_RESTRICTION)).toBe(true)
  })

  it('lets a muted person still listen', () => {
    // Mute is about being heard. Taking their hearing too would be a second
    // punishment that no label on the button describes.
    expect(canPublishUnder({ mute: true, deafen: false })).toBe(false)
    expect(canSubscribeUnder({ mute: true, deafen: false })).toBe(true)
  })

  it('treats deafen as implying no publishing', () => {
    // Someone who cannot hear the room cannot follow it, and letting them keep
    // transmitting produces a person talking over people they cannot hear.
    expect(canPublishUnder({ mute: false, deafen: true })).toBe(false)
    expect(canSubscribeUnder({ mute: false, deafen: true })).toBe(false)
  })

  it('is unambiguous when both are set', () => {
    expect(canPublishUnder({ mute: true, deafen: true })).toBe(false)
    expect(canSubscribeUnder({ mute: true, deafen: true })).toBe(false)
  })
})

describe('publishGrantFor', () => {
  const NONE = { speak: false, video: false }
  const SPEAK_ONLY = { speak: true, video: false }
  const VIDEO_ONLY = { speak: false, video: true }
  const MUTED = { mute: true, deafen: false }
  const DEAF = { mute: false, deafen: true }

  it('leaves an unrestricted member completely unrestricted', () => {
    // `sources` ABSENT, not an empty array. canPublishSources supersedes
    // canPublish in LiveKit, so an empty list would forbid everything — the
    // opposite of what this case means.
    const g = publishGrantFor(UNRESTRICTED_PERMITS, NO_RESTRICTION)
    expect(g).toEqual({ canPublish: true, canSubscribe: true })
    expect(g.sources).toBeUndefined()
  })

  it('refuses publishing outright when neither Speak nor Video is held', () => {
    // Not an empty source list: canPublish false is the unambiguous form, and
    // it is what a listener-only channel should produce.
    const g = publishGrantFor(NONE, NO_RESTRICTION)
    expect(g).toEqual({ canPublish: false, canSubscribe: true })
  })

  it('narrows to the microphone for Speak without Video', () => {
    const g = publishGrantFor(SPEAK_ONLY, NO_RESTRICTION)
    expect(g.canPublish).toBe(true)
    expect(g.sources).toEqual([TrackSource.MICROPHONE])
  })

  it('narrows to camera and screen for Video without Speak', () => {
    // Screen-share AUDIO is included: that is an application's sound, not the
    // person's voice, so it belongs to Video rather than to Speak.
    const g = publishGrantFor(VIDEO_ONLY, NO_RESTRICTION)
    expect(g.canPublish).toBe(true)
    expect(g.sources).toEqual([
      TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO,
    ])
  })

  it('takes the microphone from a server-muted member who may still film', () => {
    const g = publishGrantFor(UNRESTRICTED_PERMITS, MUTED)
    expect(g.canPublish).toBe(true)
    expect(g.sources).not.toContain(TrackSource.MICROPHONE)
    expect(g.sources).toContain(TrackSource.CAMERA)
  })

  it('closes screen-share audio to a muted member, unlike merely lacking Speak', () => {
    // The one place a permission and a moderation deliberately differ. A mute
    // that left a second audio route open would be decorative.
    expect(publishGrantFor(UNRESTRICTED_PERMITS, MUTED).sources)
      .not.toContain(TrackSource.SCREEN_SHARE_AUDIO)
    expect(publishGrantFor(VIDEO_ONLY, NO_RESTRICTION).sources)
      .toContain(TrackSource.SCREEN_SHARE_AUDIO)
  })

  it('leaves a muted member with nothing when they only ever had Speak', () => {
    const g = publishGrantFor(SPEAK_ONLY, MUTED)
    expect(g).toEqual({ canPublish: false, canSubscribe: true })
  })

  it('cuts a deafened member off entirely, whatever they hold', () => {
    for (const permits of [UNRESTRICTED_PERMITS, SPEAK_ONLY, VIDEO_ONLY, NONE]) {
      expect(publishGrantFor(permits, DEAF)).toEqual({ canPublish: false, canSubscribe: false })
    }
  })

  it('never emits an empty source list', () => {
    // The dangerous middle state: canPublish true with sources [] forbids every
    // source while claiming to allow publishing.
    const cases = [UNRESTRICTED_PERMITS, SPEAK_ONLY, VIDEO_ONLY, NONE]
      .flatMap(p => [NO_RESTRICTION, MUTED, DEAF].map(r => publishGrantFor(p, r)))
    for (const g of cases) {
      expect(g.sources === undefined || g.sources.length > 0).toBe(true)
    }
  })
})

describe('adminUrl', () => {
  it('turns the client websocket url into one RoomServiceClient can call', () => {
    // The stored URL is the one browsers dial. RoomServiceClient speaks HTTP,
    // and pointing it at a wss: scheme fails at connect time with an error that
    // reads like the media server is down.
    expect(adminUrl('wss://lk.example.com')).toBe('https://lk.example.com')
    expect(adminUrl('ws://localhost:7880')).toBe('http://localhost:7880')
  })

  it('leaves an already-HTTP url alone', () => {
    expect(adminUrl('https://lk.example.com')).toBe('https://lk.example.com')
    expect(adminUrl('http://localhost:7880')).toBe('http://localhost:7880')
  })

  it('rewrites only the scheme, never a host that happens to start with ws', () => {
    // The anchor matters: a naive replace would turn the host `ws.example.com`
    // into `http.example.com` and route audio nowhere.
    expect(adminUrl('wss://ws.example.com/path')).toBe('https://ws.example.com/path')
  })
})
