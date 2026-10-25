import { describe, it, expect } from 'vitest'
import {
  pickFocus, FOCUS_HOLD_MS, musicCardLabel, formatElapsed, callSubtitle,
  type FocusInput, type FocusState,
} from '../phoneCallRules'
import type { MusicChannelView } from '../useMusic'

// ── who fills the screen ────────────────────────────────────────────────────
const tile = (id: string, speaking = false) => ({ id, speaking })
const cam = (participantId: string, local = false) => ({ participantId, source: 'camera' as const, local })
const screen = (participantId: string) => ({ participantId, source: 'screen' as const, local: false })
const input = (o: Partial<FocusInput> = {}): FocusInput =>
  ({ tiles: [], videos: [], selfId: 'me', lastSpokeAt: {}, ...o })

describe('pickFocus: who fills a phone screen', () => {
  it('a remote screen share wins over cameras', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('me', true), cam('a'), screen('b')],
    }), null, 100)
    expect(f).toEqual({ kind: 'screen', id: 'b', since: 100 })
  })

  it('the most recent speaker among camera owners fills the screen', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b'), tile('c')],
      videos: [cam('a'), cam('b')],
      // c spoke most recently of all, but has no camera, so is not in the running.
      lastSpokeAt: { a: 5, b: 9, c: 99 },
    }), null, 100)
    expect(f).toEqual({ kind: 'camera', id: 'b', since: 100 })
  })

  it('someone speaking now beats someone who spoke more recently', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a'), cam('b')],
      lastSpokeAt: { a: 1, b: 9 },
    }), null, 100)
    expect(f).toEqual({ kind: 'camera', id: 'a', since: 100 })
  })

  it('your own camera fills only when nobody else has video', () => {
    const alone = pickFocus(input({
      tiles: [tile('me'), tile('a')],
      videos: [cam('me', true)],
    }), null, 100)
    expect(alone).toEqual({ kind: 'camera', id: 'me', since: 100 })

    const withOther = pickFocus(input({
      tiles: [tile('me', true), tile('a')],
      videos: [cam('me', true), cam('a')],
      lastSpokeAt: { me: 99 },
    }), null, 100)
    expect(withOther).toEqual({ kind: 'camera', id: 'a', since: 100 })
  })

  it("no video → the most recent remote speaker's avatar", () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b')],
      lastSpokeAt: { a: 3, b: 8 },
    }), null, 100)
    expect(f).toEqual({ kind: 'avatar', id: 'b', since: 100 })
  })

  it('whoever is speaking right now has the avatar slot', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      lastSpokeAt: { a: 3, b: 8 },
    }), null, 100)
    expect(f).toEqual({ kind: 'avatar', id: 'a', since: 100 })
  })

  it('you never take the avatar slot unless alone', () => {
    // Loud and the latest voice in the room: still not the big one.
    const crowd = pickFocus(input({
      tiles: [tile('me', true), tile('a')],
      lastSpokeAt: { me: 99, a: 1 },
    }), null, 100)
    expect(crowd).toEqual({ kind: 'avatar', id: 'a', since: 100 })

    expect(pickFocus(input({ tiles: [tile('me')] }), null, 100))
      .toEqual({ kind: 'avatar', id: 'me', since: 100 })
    expect(pickFocus(input(), null, 100))
      .toEqual({ kind: 'avatar', id: 'me', since: 100 })
  })

  it('a screen shared from this device is not the thing to look at', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a')],
      videos: [{ participantId: 'me', source: 'screen', local: true }],
    }), null, 100)
    expect(f).toEqual({ kind: 'avatar', id: 'a', since: 100 })
  })

  describe('the hold', () => {
    const both = input({
      tiles: [tile('me'), tile('a'), tile('b', true)],
      videos: [cam('a'), cam('b')],
      lastSpokeAt: { a: 1, b: 9 },
    })
    const prev: FocusState = { kind: 'camera', id: 'a', since: 0 }

    it('a new candidate replaces the current one only after FOCUS_HOLD_MS (1499 ms keeps prev, 1500 ms switches)', () => {
      expect(FOCUS_HOLD_MS).toBe(1500)
      expect(pickFocus(both, prev, FOCUS_HOLD_MS - 1)).toBe(prev)
      expect(pickFocus(both, prev, FOCUS_HOLD_MS)).toEqual({ kind: 'camera', id: 'b', since: FOCUS_HOLD_MS })
    })

    it('a screen share switches immediately (no hold)', () => {
      const shared = input({
        tiles: [tile('me'), tile('a', true), tile('b')],
        videos: [cam('a'), screen('b')],
      })
      expect(pickFocus(shared, prev, 10)).toEqual({ kind: 'screen', id: 'b', since: 10 })
    })

    it('the same candidate keeps its original since, so the hold is not restarted', () => {
      const same = input({ tiles: [tile('me'), tile('a', true)], videos: [cam('a')] })
      expect(pickFocus(same, prev, 60_000)).toBe(prev)
    })

    it('a holder whose participant has left the call is replaced at once', () => {
      const gone: FocusState = { kind: 'avatar', id: 'x', since: 0 }
      const after = input({ tiles: [tile('me'), tile('a')] })
      expect(pickFocus(after, gone, 10)).toEqual({ kind: 'avatar', id: 'a', since: 10 })
    })

    it('a holder is kept while their video has stopped, until the hold is up', () => {
      // a switched the camera off 300 ms after taking the slot: no flicker back.
      const camOff = input({ tiles: [tile('me'), tile('a'), tile('b', true)], lastSpokeAt: { a: 1, b: 9 } })
      expect(pickFocus(camOff, prev, 300)).toBe(prev)
      expect(pickFocus(camOff, prev, FOCUS_HOLD_MS)).toEqual({ kind: 'avatar', id: 'b', since: FOCUS_HOLD_MS })
    })
  })
})

// ── the Music card ──────────────────────────────────────────────────────────
type Now = NonNullable<MusicChannelView['now']>
const song = (o: Partial<Now> = {}): Now => ({
  id: 'e1', kind: 'library', title: 'Midnight City', artist: 'M83', durationSec: 243, addedBy: 'u1',
  url: null, cover: '/covers/e1.jpg', elapsedMs: 0, ...o,
})
const channel = (id: string, now: Now | null): MusicChannelView =>
  ({ id, name: id, now, queue: [], queued: 0, listeners: [], previous: false })

describe('musicCardLabel', () => {
  it('unavailable → null', () => {
    expect(musicCardLabel({ available: false, listeningTo: 'c1', channels: [channel('c1', song())] })).toBeNull()
  })

  it('tuned in with now → song (title, artist, cover)', () => {
    expect(musicCardLabel({ available: true, listeningTo: 'c1', channels: [channel('c1', song())] }))
      .toEqual({ kind: 'song', title: 'Midnight City', artist: 'M83', cover: '/covers/e1.jpg' })
  })

  it('shows the song of the channel you are tuned into, not another that is playing', () => {
    const channels = [channel('c1', song({ title: 'One' })), channel('c2', song({ title: 'Two' }))]
    expect(musicCardLabel({ available: true, listeningTo: 'c2', channels }))
      .toMatchObject({ kind: 'song', title: 'Two' })
  })

  it('a song with no artist or cover passes both through as null', () => {
    expect(musicCardLabel({
      available: true, listeningTo: 'c1',
      channels: [channel('c1', song({ artist: null, cover: null }))],
    })).toEqual({ kind: 'song', title: 'Midnight City', artist: null, cover: null })
  })

  it('tuned in, nothing queued → not-playing', () => {
    // Another channel playing does not change what YOUR channel is doing.
    const channels = [channel('c1', null), channel('c2', song())]
    expect(musicCardLabel({ available: true, listeningTo: 'c1', channels })).toEqual({ kind: 'not-playing' })
  })

  it('not tuned in, 2 channels with now → { kind: count, n: 2 }', () => {
    const channels = [channel('c1', song()), channel('c2', song()), channel('c3', null)]
    expect(musicCardLabel({ available: true, listeningTo: null, channels })).toEqual({ kind: 'count', n: 2 })
  })

  it('not tuned in, nothing playing → not-playing', () => {
    expect(musicCardLabel({ available: true, listeningTo: null, channels: [channel('c1', null)] }))
      .toEqual({ kind: 'not-playing' })
    expect(musicCardLabel({ available: true, listeningTo: null, channels: [] }))
      .toEqual({ kind: 'not-playing' })
  })

  it('a channel you were tuned into that is gone counts as not tuned in', () => {
    expect(musicCardLabel({ available: true, listeningTo: 'gone', channels: [channel('c1', song())] }))
      .toEqual({ kind: 'count', n: 1 })
  })

  it("a link with no title shows the url's host as title", () => {
    const linked = song({ kind: 'link', title: null, artist: null, cover: null, url: 'https://example.com/watch?v=1' })
    expect(musicCardLabel({ available: true, listeningTo: 'c1', channels: [channel('c1', linked)] }))
      .toEqual({ kind: 'song', title: 'example.com', artist: null, cover: null })
  })

  it('a link with neither a title nor a usable url reads as the desktop rail does', () => {
    for (const url of [null, 'not a url']) {
      const linked = song({ kind: 'link', title: null, url })
      expect(musicCardLabel({ available: true, listeningTo: 'c1', channels: [channel('c1', linked)] }))
        .toMatchObject({ kind: 'song', title: 'A linked track' })
    }
  })
})

// ── the call timer and subtitle ─────────────────────────────────────────────
describe('formatElapsed', () => {
  it('is m:ss below an hour', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(61_000)).toBe('1:01')
    expect(formatElapsed(600_000)).toBe('10:00')
    expect(formatElapsed(3_599_000)).toBe('59:59')
  })

  it('is h:mm:ss from an hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(3_661_000)).toBe('1:01:01')
  })

  it('counts whole seconds, rounding down, so it never runs ahead of the clock', () => {
    expect(formatElapsed(59_999)).toBe('0:59')
  })

  it('reads 0:00 for a start time in the future or no number at all', () => {
    expect(formatElapsed(-5_000)).toBe('0:00')
    expect(formatElapsed(NaN)).toBe('0:00')
  })
})

describe('callSubtitle', () => {
  const sub = (o: Partial<Parameters<typeof callSubtitle>[0]> = {}) =>
    callSubtitle({ kind: 'group', count: 3, onCamera: null, elapsedMs: 252_000, ...o })

  it("DM → '4:12'", () => {
    expect(sub({ kind: 'dm', count: 2 })).toBe('4:12')
  })

  it("group of 3 → '3 people · 4:12'", () => {
    expect(sub()).toBe('3 people · 4:12')
  })

  it('a voice channel reads like a group', () => {
    expect(sub({ kind: 'channel', count: 5 })).toBe('5 people · 4:12')
  })

  it("group with Anavuf on camera → '4 people · Anavuf on camera'", () => {
    expect(sub({ count: 4, onCamera: 'Anavuf' })).toBe('4 people · Anavuf on camera')
  })

  it("no elapsed → '3 people'", () => {
    expect(sub({ elapsedMs: null })).toBe('3 people')
  })

  it('a DM with no elapsed time yet has no subtitle', () => {
    expect(sub({ kind: 'dm', count: 2, elapsedMs: null })).toBe('')
  })

  it("a DM does not name the one other person: they are the call's name already", () => {
    expect(sub({ kind: 'dm', count: 2, onCamera: 'Anavuf' })).toBe('4:12')
  })

  it('on camera still shows when the timer has not started', () => {
    expect(sub({ count: 4, onCamera: 'Anavuf', elapsedMs: null })).toBe('4 people · Anavuf on camera')
  })

  it('one person alone is not "1 people"', () => {
    expect(sub({ count: 1 })).toBe('1 person · 4:12')
    expect(sub({ count: 1, elapsedMs: null })).toBe('1 person')
  })
})
