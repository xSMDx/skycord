import { describe, it, expect } from 'vitest'
import {
  pickFocus, focusedVideo, shareSlot, streamRow, FOCUS_HOLD_MS, musicCardLabel, formatElapsed, callSubtitle,
  type FocusInput, type FocusState,
} from '../phoneCallRules'
import type { MusicChannelView } from '../useMusic'

// ── who fills the screen ────────────────────────────────────────────────────
const tile = (id: string, speaking = false) => ({ id, speaking })
const cam = (participantId: string, local = false) => ({ participantId, source: 'camera' as const, local })
const screen = (participantId: string) => ({ participantId, source: 'screen' as const, local: false })
const input = (o: Partial<FocusInput> = {}): FocusInput =>
  ({ tiles: [], videos: [], selfId: 'me', lastSpokeAt: {}, ...o })
/** A holder with nobody waiting behind them. */
const focus = (kind: FocusState['kind'], id: string, since: number): FocusState =>
  ({ kind, id, since, pending: null })

describe('pickFocus: who fills a phone screen', () => {
  it('a remote screen share wins over cameras', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('me', true), cam('a'), screen('b')],
    }), null, 100)
    expect(f).toEqual(focus('screen', 'b', 100))
  })

  it('the most recent speaker among camera owners fills the screen', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b'), tile('c')],
      videos: [cam('a'), cam('b')],
      // c spoke most recently of all, but has no camera, so is not in the running.
      lastSpokeAt: { a: 5, b: 9, c: 99 },
    }), null, 100)
    expect(f).toEqual(focus('camera', 'b', 100))
  })

  it('someone speaking now beats someone who spoke more recently', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a'), cam('b')],
      lastSpokeAt: { a: 1, b: 9 },
    }), null, 100)
    expect(f).toEqual(focus('camera', 'a', 100))
  })

  it('your own camera fills only when nobody else has video', () => {
    const alone = pickFocus(input({
      tiles: [tile('me'), tile('a')],
      videos: [cam('me', true)],
    }), null, 100)
    expect(alone).toEqual(focus('camera', 'me', 100))

    const withOther = pickFocus(input({
      tiles: [tile('me', true), tile('a')],
      videos: [cam('me', true), cam('a')],
      lastSpokeAt: { me: 99 },
    }), null, 100)
    expect(withOther).toEqual(focus('camera', 'a', 100))
  })

  it("no video → the most recent remote speaker's avatar", () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b')],
      lastSpokeAt: { a: 3, b: 8 },
    }), null, 100)
    expect(f).toEqual(focus('avatar', 'b', 100))
  })

  it('whoever is speaking right now has the avatar slot', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      lastSpokeAt: { a: 3, b: 8 },
    }), null, 100)
    expect(f).toEqual(focus('avatar', 'a', 100))
  })

  it('you never take the avatar slot unless alone', () => {
    // Loud and the latest voice in the room: still not the big one.
    const crowd = pickFocus(input({
      tiles: [tile('me', true), tile('a')],
      lastSpokeAt: { me: 99, a: 1 },
    }), null, 100)
    expect(crowd).toEqual(focus('avatar', 'a', 100))

    expect(pickFocus(input({ tiles: [tile('me')] }), null, 100)).toEqual(focus('avatar', 'me', 100))
    expect(pickFocus(input(), null, 100)).toEqual(focus('avatar', 'me', 100))
  })

  it('a screen shared from this device is not the thing to look at', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a')],
      videos: [{ participantId: 'me', source: 'screen', local: true }],
    }), null, 100)
    expect(f).toEqual(focus('avatar', 'a', 100))
  })

  describe('the hold: a newcomer has to keep wanting the slot', () => {
    // a holds it; b is the one the grid's ranking now wants.
    const holder = focus('camera', 'a', 0)
    const bWanted = input({
      tiles: [tile('me'), tile('a'), tile('b', true)],
      videos: [cam('a'), cam('b')],
      lastSpokeAt: { a: 1, b: 9 },
    })
    const aWanted = input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a'), cam('b')],
      lastSpokeAt: { a: 9, b: 1 },
    })

    it('a newcomer wanted continuously for 1500 ms takes the slot (pending at t, switch at t+1500, not at t+1499)', () => {
      expect(FOCUS_HOLD_MS).toBe(1500)
      // The holder has had the slot since 0: how long THEY have had it is not the question.
      const t = 60_000
      const waiting = pickFocus(bWanted, holder, t)
      expect(waiting).toEqual({ kind: 'camera', id: 'a', since: 0, pending: { kind: 'camera', id: 'b', since: t } })

      expect(pickFocus(bWanted, waiting, t + FOCUS_HOLD_MS - 1)).toBe(waiting)
      expect(pickFocus(bWanted, waiting, t + FOCUS_HOLD_MS)).toEqual(focus('camera', 'b', t + FOCUS_HOLD_MS))
    })

    it('a newcomer who speaks once does not take the slot (B wanted at 1600 then A wanted again at 1700 → A holds, pending cleared)', () => {
      const waiting = pickFocus(bWanted, holder, 1600)
      expect(waiting.id).toBe('a')
      expect(waiting.pending).toMatchObject({ id: 'b', since: 1600 })

      expect(pickFocus(aWanted, waiting, 1700)).toEqual(focus('camera', 'a', 0))
    })

    it('a different newcomer restarts the pending clock', () => {
      const cWanted = input({
        tiles: [tile('me'), tile('a'), tile('b'), tile('c', true)],
        videos: [cam('a'), cam('b'), cam('c')],
        lastSpokeAt: { a: 1, b: 2, c: 9 },
      })
      const b1 = pickFocus(bWanted, holder, 1000)
      const c1 = pickFocus(cWanted, b1, 2000)
      expect(c1.pending).toEqual({ kind: 'camera', id: 'c', since: 2000 })

      // b's first sighting was 1500 ms ago; it does not count for a second go.
      const b2 = pickFocus(bWanted, c1, 2500)
      expect(b2.id).toBe('a')
      expect(b2.pending).toEqual({ kind: 'camera', id: 'b', since: 2500 })

      // And c, wanted again, starts from scratch too rather than from 2000.
      const c2 = pickFocus(cWanted, b2, 3000)
      expect(c2.pending).toEqual({ kind: 'camera', id: 'c', since: 3000 })
      expect(pickFocus(cWanted, c2, 3000 + FOCUS_HOLD_MS - 1)).toBe(c2)
      expect(pickFocus(cWanted, c2, 3000 + FOCUS_HOLD_MS)).toEqual(focus('camera', 'c', 3000 + FOCUS_HOLD_MS))
    })

    it('the same candidate keeps its original since, so the hold is not restarted', () => {
      const same = input({ tiles: [tile('me'), tile('a', true)], videos: [cam('a')] })
      expect(pickFocus(same, holder, 60_000)).toBe(holder)
    })

    it('a screen share switches immediately (no hold)', () => {
      const shared = input({
        tiles: [tile('me'), tile('a', true), tile('b')],
        videos: [cam('a'), screen('b')],
      })
      expect(pickFocus(shared, holder, 10)).toEqual(focus('screen', 'b', 10))
    })

    it('a screen share arriving drops anyone who was waiting behind the holder', () => {
      const waiting = pickFocus(bWanted, holder, 100)
      const shared = input({
        tiles: [tile('me'), tile('a'), tile('b', true)],
        videos: [cam('a'), screen('b')],
      })
      expect(pickFocus(shared, waiting, 200)).toEqual(focus('screen', 'b', 200))
    })

    it('a second screen share does not cut in on the first: it waits like any newcomer', () => {
      const screens = input({
        tiles: [tile('me'), tile('a'), tile('b', true)],
        videos: [screen('a'), screen('b')],
        lastSpokeAt: { a: 1, b: 9 },
      })
      const sharing = focus('screen', 'a', 0)
      const waiting = pickFocus(screens, sharing, 100)
      expect(waiting).toEqual({ kind: 'screen', id: 'a', since: 0, pending: { kind: 'screen', id: 'b', since: 100 } })
      expect(pickFocus(screens, waiting, 100 + FOCUS_HOLD_MS)).toEqual(focus('screen', 'b', 100 + FOCUS_HOLD_MS))
    })

    it('a departed holder is replaced at once', () => {
      const gone = focus('avatar', 'x', 0)
      const after = input({ tiles: [tile('me'), tile('a')] })
      expect(pickFocus(after, gone, 10)).toEqual(focus('avatar', 'a', 10))
    })

    it('the holder turning their camera on switches kind at once and keeps since', () => {
      const talking = focus('avatar', 'a', 500)
      const camOn = input({ tiles: [tile('me'), tile('a', true)], videos: [cam('a')] })
      expect(pickFocus(camOn, talking, 700)).toEqual(focus('camera', 'a', 500))

      // Someone who was waiting behind them is no longer waiting for anything.
      const waiting: FocusState = { ...talking, pending: { kind: 'avatar', id: 'b', since: 600 } }
      expect(pickFocus(camOn, waiting, 700)).toEqual(focus('camera', 'a', 500))
    })

    it('the holder turning their camera off switches back at once and keeps since', () => {
      const onCamera = focus('camera', 'a', 500)
      const camOff = input({ tiles: [tile('me'), tile('a', true)] })
      expect(pickFocus(camOff, onCamera, 700)).toEqual(focus('avatar', 'a', 500))
    })

    it('a holder whose video has stopped stays until a newcomer has waited out the hold', () => {
      // a switched the camera off, and someone else is the best of what is left.
      const camOff = input({ tiles: [tile('me'), tile('a'), tile('b', true)], lastSpokeAt: { a: 1, b: 9 } })
      const waiting = pickFocus(camOff, holder, 300)
      expect(waiting).toEqual({ kind: 'camera', id: 'a', since: 0, pending: { kind: 'avatar', id: 'b', since: 300 } })
      expect(pickFocus(camOff, waiting, 300 + FOCUS_HOLD_MS)).toEqual(focus('avatar', 'b', 300 + FOCUS_HOLD_MS))
    })
  })
})

// Whether the big slot is a picture or a person. The screen fades its controls
// over a picture only, and the stage draws the slot by the same rule.
describe('focusedVideo: is a picture what fills the screen', () => {
  const track = (participantId: string, source: 'camera' | 'screen') => ({ participantId, source })

  it('is the focused person’s track of the focused kind', () => {
    const a = track('a', 'camera')
    expect(focusedVideo([track('b', 'camera'), a], focus('camera', 'a', 0))).toBe(a)
    const share = track('b', 'screen')
    expect(focusedVideo([track('b', 'camera'), share], focus('screen', 'b', 0))).toBe(share)
  })

  it('is null for an avatar, even when that person has a video of their own', () => {
    expect(focusedVideo([track('a', 'camera')], focus('avatar', 'a', 0))).toBeNull()
  })

  it('is null with no focus yet, and with no videos at all', () => {
    expect(focusedVideo([track('a', 'camera')], null)).toBeNull()
    expect(focusedVideo([], focus('camera', 'a', 0))).toBeNull()
  })

  it('is null when the track is of another kind than the focus, or another person’s', () => {
    expect(focusedVideo([track('a', 'screen')], focus('camera', 'a', 0))).toBeNull()
    expect(focusedVideo([track('b', 'camera')], focus('camera', 'a', 0))).toBeNull()
  })

  it('is null for a camera holder whose video has stopped, while a newcomer waits out the hold', () => {
    // a held the slot on camera and switched it off; b is who the ranking now wants.
    const held = focus('camera', 'a', 0)
    const camOff = input({ tiles: [tile('me'), tile('a'), tile('b', true)], lastSpokeAt: { a: 1, b: 9 } })
    const waiting = pickFocus(camOff, held, 300)
    // pickFocus still says 'camera' for a: that is the case focus.kind gets wrong.
    expect(waiting).toMatchObject({ kind: 'camera', id: 'a', pending: { id: 'b' } })
    expect(focusedVideo([], waiting)).toBeNull()
    // The same holder with their camera on is a picture.
    const withVideo = [track('a', 'camera')]
    const camOn = pickFocus(input({ tiles: [tile('me'), tile('a')], videos: [cam('a')] }), held, 300)
    expect(focusedVideo(withVideo, camOn)).toBe(withVideo[0])
  })

  it('is null for a share that has ended, with a camera still on', () => {
    expect(focusedVideo([track('a', 'camera')], focus('screen', 'a', 0))).toBeNull()
  })
})

// A shared screen is not loaded until Join stream (spec 6), so a share can be
// on the call with no picture here at all. It still fills the screen — as the
// sharer's tile with Join stream (spec 8), or while it loads after the tap.
describe('pickFocus: a share with no picture here', () => {
  const share = (id: string, joined = false) => ({ id, joined })

  it('a share nobody here has joined fills the screen, over cameras, as a screen', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a')],
      shares: [share('b')],
    }), null, 100)
    expect(f).toEqual(focus('screen', 'b', 100))
  })

  it('arriving, it takes the slot from a camera at once, as any screen does', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a')],
      shares: [share('b')],
    }), focus('camera', 'a', 0), 10)
    expect(f).toEqual(focus('screen', 'b', 10))
  })

  it('a share you are watching is not pushed aside by one you have not joined, however loud its sharer', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b', true)],
      videos: [screen('a')],
      shares: [share('b')],
      lastSpokeAt: { b: 99 },
    }), null, 100)
    expect(f).toEqual(focus('screen', 'a', 100))
  })

  it('one you joined that is still loading wins over one you have not joined', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      shares: [share('a'), share('b', true)],
      lastSpokeAt: { a: 99 },
    }), null, 100)
    expect(f).toEqual(focus('screen', 'b', 100))
  })

  it('among shares you have not joined, the most recent speaker’s comes first', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a'), tile('b')],
      shares: [share('a'), share('b')],
      lastSpokeAt: { a: 1, b: 9 },
    }), null, 100)
    expect(f).toEqual(focus('screen', 'b', 100))
  })

  it('joining, and the picture arriving, keep the slot and its since: the tile turns into the picture in place', () => {
    const tiles = [tile('me'), tile('a', true), tile('b')]
    const waiting = focus('screen', 'b', 100)
    const loading = pickFocus(input({ tiles, videos: [cam('a')], shares: [share('b', true)] }), waiting, 200)
    expect(loading).toBe(waiting)
    const shown = pickFocus(input({ tiles, videos: [cam('a'), screen('b')] }), loading, 300)
    expect(shown).toBe(waiting)
  })

  it('leaving the stream hands the slot back to its tile, not to the next camera', () => {
    const watching = focus('screen', 'b', 100)
    const left = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a')],
      shares: [share('b')],
    }), watching, 200)
    expect(left).toBe(watching)
  })

  it('a sharer known only by their share is still in the call: the holder is kept, not dropped at once', () => {
    // Presence can lag the room; the share is proof enough that they are here.
    const holder = focus('screen', 'b', 0)
    const f = pickFocus(input({ tiles: [tile('me'), tile('a', true)], videos: [screen('a')], shares: [share('b')] }), holder, 100)
    expect(f).toMatchObject({ kind: 'screen', id: 'b', pending: { kind: 'screen', id: 'a' } })
  })

  it('without shares, nothing changes: the input field is optional', () => {
    const f = pickFocus(input({ tiles: [tile('me'), tile('a')] }), null, 100)
    expect(f).toEqual(focus('avatar', 'a', 100))
  })
})

// Ruling T4-3: a stream you have just joined — from the stage's tile or from
// the person sheet — is an explicit choice. It takes the slot at once, holds
// it through anyone talking, and gives it up only to another choice, to its
// share ending, or to you leaving it.
describe('pickFocus: the stream you chose', () => {
  const share = (id: string, joined = false) => ({ id, joined })
  const tiles = [tile('me'), tile('a'), tile('b')]

  it('joined from the sheet while another share shows, it takes the slot at once: the loading veil first, then its picture', () => {
    const watchingA = focus('screen', 'a', 0)
    const loading = input({ tiles, videos: [screen('a')], shares: [share('b', true)], chosen: 'b', lastSpokeAt: { a: 99 } })
    const now = pickFocus(loading, watchingA, 100)
    // No hold, and nobody left waiting behind it.
    expect(now).toEqual(focus('screen', 'b', 100))
    // The slot shows b loading, not a's picture.
    expect(shareSlot([screen('a')], now, [share('b', true)])).toBe('loading')
    // Its picture arrives into the same slot.
    const shown = pickFocus(input({ tiles, videos: [screen('a'), screen('b')], chosen: 'b', lastSpokeAt: { a: 99 } }), now, 200)
    expect(shown).toBe(now)
    expect(shareSlot([screen('a'), screen('b')], shown, [])).toBe('picture')
  })

  it('a speaker change does not steal it, however long they talk', () => {
    const chose = focus('screen', 'b', 0)
    const aTalks = input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [screen('a'), screen('b'), cam('a')],
      chosen: 'b', lastSpokeAt: { a: 99_999, b: 1 },
    })
    const t1 = pickFocus(aTalks, chose, 10_000)
    expect(t1).toBe(chose)
    expect(pickFocus(aTalks, t1, 10_000 + FOCUS_HOLD_MS * 4)).toBe(chose)
  })

  it('beats a camera and a share you have not joined, as any screen would, and does not wait to', () => {
    const f = pickFocus(input({
      tiles: [tile('me'), tile('a', true), tile('b')],
      videos: [cam('a')], shares: [share('a'), share('b', true)], chosen: 'b',
    }), focus('screen', 'a', 0), 50)
    expect(f).toEqual(focus('screen', 'b', 50))
  })

  it('another choice replaces it at once', () => {
    const chose = focus('screen', 'b', 0)
    const next = pickFocus(input({ tiles, videos: [screen('b')], shares: [share('a', true)], chosen: 'a' }), chose, 300)
    expect(next).toEqual(focus('screen', 'a', 300))
  })

  it('when its share ends, normal picking resumes: the next share waits out the hold', () => {
    const chose = focus('screen', 'b', 0)
    // b stopped sharing; a's picture is what is left. The choice is gone with the share.
    const ended = input({ tiles, videos: [screen('a')], chosen: null })
    const waiting = pickFocus(ended, chose, 500)
    expect(waiting).toMatchObject({ kind: 'screen', id: 'b', pending: { kind: 'screen', id: 'a' } })
    expect(pickFocus(ended, waiting, 500 + FOCUS_HOLD_MS)).toEqual(focus('screen', 'a', 500 + FOCUS_HOLD_MS))
  })

  it('a choice that no longer stands — its share stopped, or it is hidden — is not forced onto the stage', () => {
    // A stale id with nothing behind it changes nothing.
    const plain = input({ tiles: [tile('me'), tile('a'), tile('b', true)], videos: [screen('a')], chosen: 'b' })
    expect(pickFocus(plain, null, 100)).toEqual(focus('screen', 'a', 100))
    // Not joined any more (left): its tile is a share like any other.
    const left = input({ tiles, videos: [screen('a')], shares: [share('b')], chosen: 'b' })
    expect(pickFocus(left, null, 100)).toEqual(focus('screen', 'a', 100))
  })

  it('when you leave it, normal picking resumes: with nothing else to show, its Join tile stays', () => {
    const chose = focus('screen', 'b', 0)
    const left = pickFocus(input({ tiles, shares: [share('b')], chosen: null }), chose, 400)
    expect(left).toBe(chose)
    expect(shareSlot([], left, [share('b')])).toBe('join')
  })
})

// What the big slot draws for a screen share: the picture, the sharer's tile
// with Join stream, or that tile while the stream loads. The stage draws by
// it, and the long-press that opens the person sheet asks it too.
describe('shareSlot: what the big slot shows for a share', () => {
  const track = (participantId: string, source: 'camera' | 'screen') => ({ participantId, source })
  const share = (id: string, joined = false) => ({ id, joined })

  it('is the picture when the focused share has one', () => {
    expect(shareSlot([track('b', 'screen')], focus('screen', 'b', 0), [])).toBe('picture')
  })

  it('is Join stream for a share not joined, and loading for one joined with no picture yet', () => {
    expect(shareSlot([], focus('screen', 'b', 0), [share('b')])).toBe('join')
    expect(shareSlot([], focus('screen', 'b', 0), [share('b', true)])).toBe('loading')
  })

  it('is nothing when the slot is not a share: no focus, a camera, a person', () => {
    expect(shareSlot([track('b', 'screen')], null, [share('b')])).toBeNull()
    expect(shareSlot([track('b', 'camera')], focus('camera', 'b', 0), [share('b')])).toBeNull()
    expect(shareSlot([], focus('avatar', 'b', 0), [share('b')])).toBeNull()
  })

  it('is nothing for a share that has stopped: the holder is drawn as the person', () => {
    expect(shareSlot([track('b', 'camera')], focus('screen', 'b', 0), [share('a')])).toBeNull()
  })
})

// The person sheet's stream row (ruling T4-2): every share must be joinable
// (spec 6), and the stage shows only one, so the sheet offers the way in too —
// and, once joined, the way out in the same place.
describe('streamRow: Join stream or Leave stream in the person sheet', () => {
  it('is nothing when they are not sharing a screen', () => {
    expect(streamRow({ sharing: false, joined: false, hidden: false })).toBeNull()
  })

  it('is Join stream for a share you have not joined', () => {
    expect(streamRow({ sharing: true, joined: false, hidden: false })).toBe('join')
  })

  it('is Leave stream once you have joined it', () => {
    expect(streamRow({ sharing: true, joined: true, hidden: false })).toBe('leave')
  })

  it('offers no Join for a share hidden by Disable Video — it would load and never be drawn — but still lets you leave one', () => {
    expect(streamRow({ sharing: true, joined: false, hidden: true })).toBeNull()
    expect(streamRow({ sharing: true, joined: true, hidden: true })).toBe('leave')
  })

  it('is nothing for a stream still marked joined after its share has stopped', () => {
    expect(streamRow({ sharing: false, joined: true, hidden: false })).toBeNull()
  })
})

// ── the Music card ──────────────────────────────────────────────────────────
type Now =NonNullable<MusicChannelView['now']>
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
