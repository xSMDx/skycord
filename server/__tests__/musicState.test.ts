/// <reference types="node" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MusicRooms, EMPTY_GRACE_MS, MAX_SEEK_SEC } from '../sockets/musicState'
import { DEFAULT_CAPS } from '../utils/musicLimits'

const caps = { ...DEFAULT_CAPS, channelsPerCall: 3, channelsPerInstance: 4, queuePerChannel: 2 }
const ROOM = 'voice:abc'
const OTHER = 'voice:xyz'

let closed: string[]
const make = () => {
  closed = []
  return new MusicRooms(caps, (room, id) => closed.push(`${room}/${id}`))
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const idOf = (r: { ok: boolean; id?: string }) => {
  expect(r.ok).toBe(true)
  return r.id as string
}

describe('creating channels', () => {
  it('creates one and plays the first track immediately', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    const v = m.view(ROOM).channels
    expect(v).toHaveLength(1)
    expect(v[0].name).toBe('Chill')
    expect(v[0].now?.url).toBe('https://x/a.mp3')
    expect(m.get(ROOM, id)?.createdBy).toBe('ana')
  })

  it('does NOT make the creator a listener', () => {
    // Starting a channel and tuning into it are two decisions. If creating
    // auto-subscribed, the grace period below could never fire for a channel
    // nobody actually chose to hear.
    const m = make()
    m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(m.view(ROOM).channels[0].listeners).toEqual([])
  })

  it('refuses past the per-call cap', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    const r = m.create(ROOM, 'one too many', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(r.ok).toBe(false)
  })

  it('refuses past the instance cap even when this room has space', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(m.create(OTHER, 'first here', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ben').ok).toBe(true)   // 4th overall
    const r = m.create(OTHER, 'fifth', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ben')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('server')
  })

  it('counts channels across rooms, not just the one asked about', () => {
    const m = make()
    m.create(ROOM, 'a', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    m.create(OTHER, 'b', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ben')
    expect(m.channelsHere(ROOM)).toBe(1)
    expect(m.channelsEverywhere()).toBe(2)
  })
})

describe('queueing and skipping', () => {
  it('queues behind what is playing', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/1.mp3' }, 'ana'))
    expect(m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/2.mp3' }, 'ben').ok).toBe(true)
    const v = m.view(ROOM).channels[0]
    expect(v.now?.url).toBe('https://x/1.mp3')
    expect(v.queued).toBe(1)
  })

  it('refuses a full queue', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/1.mp3' }, 'ana'))
    expect(m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/2.mp3' }, 'ben').ok).toBe(true)
    expect(m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/3.mp3' }, 'ben').ok).toBe(true)
    expect(m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/4.mp3' }, 'ben').ok).toBe(false)
  })

  it('skip advances to the next track', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/1.mp3' }, 'ana'))
    m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/2.mp3' }, 'ben')
    const r = m.skip(ROOM, id)
    expect(r.ok).toBe(true)
    expect(r.now?.url).toBe('https://x/2.mp3')
    expect(m.view(ROOM).channels[0].queued).toBe(0)
  })

  it('skipping the last track leaves the channel open and silent', () => {
    // Not closed: a listener can see "nothing playing" and queue something.
    // Closing it under them would take the channel away mid-conversation
    // about what to play next.
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/1.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id)
    expect(m.skip(ROOM, id).now).toBeNull()
    expect(m.view(ROOM).channels).toHaveLength(1)
    expect(m.view(ROOM).channels[0].now).toBeNull()
  })

  it('refuses to queue or skip a channel that is gone', () => {
    const m = make()
    expect(m.queue(ROOM, 'nope', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana').ok).toBe(false)
    expect(m.skip(ROOM, 'nope').ok).toBe(false)
  })
})

describe('listening', () => {
  it('tunes a member in', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    expect(m.listen(ROOM, 'ana', id).ok).toBe(true)
    expect(m.view(ROOM).channels[0].listeners).toEqual(['ana'])
  })

  it('moves a member between channels rather than adding them to both', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    const b = idOf(m.create(ROOM, 'Metal', { kind: 'link' as const, url: 'https://x/b.mp3' }, 'ben'))
    m.listen(ROOM, 'ana', a)
    m.listen(ROOM, 'ana', b)
    const v = m.view(ROOM).channels
    expect(v.find(c => c.id === a)!.listeners).toEqual([])
    expect(v.find(c => c.id === b)!.listeners).toEqual(['ana'])
  })

  it('null tunes out of everything', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id)
    expect(m.listen(ROOM, 'ana', null).ok).toBe(true)
    expect(m.view(ROOM).channels[0].listeners).toEqual([])
  })

  it('refuses a channel that is gone', () => {
    const m = make()
    expect(m.listen(ROOM, 'ana', 'nope').ok).toBe(false)
  })

  it('several members can share a channel', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id); m.listen(ROOM, 'ben', id)
    expect(m.view(ROOM).channels[0].listeners.sort()).toEqual(['ana', 'ben'])
  })
})

describe('the empty-channel grace period', () => {
  it('a channel nobody ever joined is torn down after the grace period', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    expect(m.closePending(ROOM, id)).toBe(true)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed).toEqual([`${ROOM}/${id}`])
  })

  it('is cancelled the moment somebody listens', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id)
    expect(m.closePending(ROOM, id)).toBe(false)
    vi.advanceTimersByTime(EMPTY_GRACE_MS * 3)
    expect(m.view(ROOM).channels).toHaveLength(1)
  })

  it('does not tear down a channel somebody came back to inside the window', () => {
    // Switching channels, or riding out a blip, momentarily empties one.
    // Destroying it on the instant is the bug the call-end grace period
    // exists to prevent, one layer up.
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id)
    m.listen(ROOM, 'ana', null)
    expect(m.closePending(ROOM, id)).toBe(true)
    vi.advanceTimersByTime(EMPTY_GRACE_MS / 2)
    m.listen(ROOM, 'ana', id)
    vi.advanceTimersByTime(EMPTY_GRACE_MS * 2)
    expect(m.view(ROOM).channels).toHaveLength(1)
    expect(closed).toEqual([])
  })

  it('tears down after the window if nobody came back', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.listen(ROOM, 'ana', id)
    m.listen(ROOM, 'ana', null)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed).toEqual([`${ROOM}/${id}`])
  })

  it('arms only once, so a flapping listener does not stack timers', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    for (let i = 0; i < 5; i++) { m.listen(ROOM, 'ana', id); m.listen(ROOM, 'ana', null) }
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(closed).toEqual([`${ROOM}/${id}`])   // exactly one teardown, not five
  })
})

describe('members leaving', () => {
  it('forget drops a member from every channel and names the rooms that changed', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    const b = idOf(m.create(OTHER, 'Metal', { kind: 'link' as const, url: 'https://x/b.mp3' }, 'ben'))
    m.listen(ROOM, 'ana', a)
    m.listen(OTHER, 'ana', b)
    const touched = m.forget('ana')
    expect(touched.sort()).toEqual([ROOM, OTHER].sort())
    expect(m.view(ROOM).channels[0].listeners).toEqual([])
  })

  it('forget names no room when the member was listening to nothing', () => {
    const m = make()
    m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(m.forget('nobody')).toEqual([])
  })

  it('closeRoom tears everything down at once', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'a', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    const b = idOf(m.create(ROOM, 'b', { kind: 'link' as const, url: 'https://x/b.mp3' }, 'ana'))
    m.closeRoom(ROOM)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed.sort()).toEqual([`${ROOM}/${a}`, `${ROOM}/${b}`].sort())
  })

  it('frees the room slot so a new channel can be made after teardown', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(m.create(ROOM, 'full', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana').ok).toBe(false)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)       // all three were empty
    expect(m.channelsEverywhere()).toBe(0)
    expect(m.create(ROOM, 'room again', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana').ok).toBe(true)
  })
})

describe('shutdown', () => {
  it('cancelAllCloses concludes nothing', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    m.cancelAllCloses()
    vi.advanceTimersByTime(EMPTY_GRACE_MS * 3)
    // The process is going away; a channel it stops tracking is not a channel
    // that ended. Same reasoning as cancelAllCallEnds.
    expect(closed).toEqual([])
    expect(m.view(ROOM).channels).toHaveLength(1)
    expect(m.get(ROOM, id)).toBeDefined()
  })
})

describe('what a listener is told', () => {
  // A listener used to be told a title, at best. These are the fields that
  // let the mini player and the call rail say what you are actually hearing.
  const lib = (title: string, extra: Partial<{ artist: string; durationSec: number; cover: string | null }> = {}) => ({
    kind: 'library' as const, trackId: 'a'.repeat(24), title,
    artist: extra.artist ?? 'Probe Band', durationSec: extra.durationSec ?? 200,
    cover: extra.cover ?? null,
  })
  let clock = 1_000_000
  const timed = () => new MusicRooms(caps, () => {}, () => clock)

  it('carries a library track\'s title, artist, length and cover', () => {
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', lib('Blue Monday', { cover: 'data:image/webp;base64,AAAA' }), 'ana'))
    const now = m.view(ROOM).channels.find(c => c.id === id)!.now!
    expect(now).toMatchObject({
      kind: 'library', title: 'Blue Monday', artist: 'Probe Band', durationSec: 200,
      cover: 'data:image/webp;base64,AAAA', url: null, addedBy: 'ana',
    })
  })

  it('says how far in as elapsed time, not as a timestamp', () => {
    // Elapsed is clock-skew-free: a client a minute fast still draws the bar
    // in the right place, because it only adds its own elapsed time to this.
    clock = 1_000_000
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', lib('One'), 'ana'))
    clock += 42_000
    expect(m.view(ROOM).channels.find(c => c.id === id)!.now!.elapsedMs).toBe(42_000)
  })

  it('starts the clock again when the next song begins', () => {
    clock = 1_000_000
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', lib('One'), 'ana'))
    m.queue(ROOM, id, lib('Two'), 'ben')
    clock += 90_000
    m.skip(ROOM, id)
    clock += 5_000
    const now = m.view(ROOM).channels.find(c => c.id === id)!.now!
    expect(now.title).toBe('Two')
    expect(now.elapsedMs).toBe(5_000)
  })

  it('lists the shared queue in order, with who added each song', () => {
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', lib('One'), 'ana'))
    m.queue(ROOM, id, lib('Two'), 'ben')
    m.queue(ROOM, id, { kind: 'link' as const, url: 'https://x/three.mp3' }, 'cy')
    const view = m.view(ROOM).channels.find(c => c.id === id)!
    expect(view.queue.map(q => [q.title, q.addedBy])).toEqual([['Two', 'ben'], [null, 'cy']])
    expect(view.queued).toBe(2)
  })

  it('never sends a cover for anything but the playing song', () => {
    // Covers are the heavy part of this broadcast, and it goes to everyone in
    // the call on every change. Only one per channel travels.
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', lib('One'), 'ana'))
    m.queue(ROOM, id, lib('Two', { cover: 'data:image/webp;base64,BBBB' }), 'ben')
    const queued = m.view(ROOM).channels.find(c => c.id === id)!.queue[0] as Record<string, unknown>
    expect(queued).not.toHaveProperty('cover')
  })

  it('a pasted link has no title and no length to show', () => {
    const m = timed()
    const id = idOf(m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana'))
    const now = m.view(ROOM).channels.find(c => c.id === id)!.now!
    expect(now).toMatchObject({ kind: 'link', title: null, durationSec: null, url: 'https://x/a.mp3' })
  })
})

describe('moving through a shared song', () => {
  // Anyone in a channel can move the song or play a queued one now. These
  // are the state halves; the socket tests cover who may ask.
  const lib = (title: string, durationSec = 200) => ({
    kind: 'library' as const, trackId: 'a'.repeat(24), title, artist: 'X', durationSec, cover: null,
  })
  const clockRooms = () => {
    let t = 1_000_000
    // Default caps: this file's own caps hold a queue of two, and play-now
    // needs a queue long enough to have a middle.
    const m = new MusicRooms({ ...DEFAULT_CAPS }, () => {}, () => t)
    return { m, tick: (ms: number) => { t += ms } }
  }

  it('gives every queued entry a stable id', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    m.queue(ROOM, id, lib('Two'), 'u1'); m.queue(ROOM, id, lib('Three'), 'u2')
    const q = m.view(ROOM).channels[0].queue
    expect(q).toHaveLength(2)
    expect(new Set(q.map(e => e.id)).size).toBe(2)
    expect(q.every(e => typeof e.id === 'string' && e.id.length > 0)).toBe(true)
    // Stable: the same entry keeps its id from one view to the next.
    expect(m.view(ROOM).channels[0].queue[0].id).toBe(q[0].id)
  })

  it('seek moves the clock for everyone', () => {
    const { m, tick } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    tick(10_000)
    const r = m.seek(ROOM, id, 120)
    expect(r.ok).toBe(true)
    expect(r.sec).toBe(120)
    expect(m.view(ROOM).channels[0].now?.elapsedMs).toBe(120_000)
  })

  it('seek clamps to the last second of a known length', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One', 200), 'u1'))
    expect(m.seek(ROOM, id, 999).sec).toBe(199)
  })

  it('seek floors to whole seconds', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    expect(m.seek(ROOM, id, 42.9).sec).toBe(42)
  })

  it('seek refuses nonsense, an idle channel and a missing one', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    for (const bad of [-1, Number.NaN, Infinity, '30', null, undefined, MAX_SEEK_SEC + 1]) {
      expect(m.seek(ROOM, id, bad).ok).toBe(false)
    }
    m.skip(ROOM, id)                         // queue empty: nothing playing now
    expect(m.seek(ROOM, id, 10).ok).toBe(false)
    expect(m.seek(ROOM, 'nope', 10).ok).toBe(false)
  })

  it('seek on a link has no end to clamp to', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'u1'))
    expect(m.seek(ROOM, id, 4000).sec).toBe(4000)
  })

  it('play now takes that entry out and keeps the rest in order', () => {
    const { m, tick } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    for (const t of ['Two', 'Three', 'Four']) m.queue(ROOM, id, lib(t), 'u1')
    const three = m.view(ROOM).channels[0].queue[1].id
    tick(50_000)
    const r = m.playNow(ROOM, id, three)
    expect(r.ok).toBe(true)
    const v = m.view(ROOM).channels[0]
    expect(v.now?.title).toBe('Three')
    expect(v.now?.elapsedMs).toBe(0)
    expect(v.queue.map(e => e.title)).toEqual(['Two', 'Four'])
  })

  it('play now refuses an entry that is gone', () => {
    const { m } = clockRooms()
    const id = idOf(m.create(ROOM, 'C', lib('One'), 'u1'))
    expect(m.playNow(ROOM, id, 'not-an-entry').ok).toBe(false)
    expect(m.playNow(ROOM, 'nope', 'x').ok).toBe(false)
  })
})

describe('whose state this is', () => {
  it('names its room, because it is sent to everyone in the server', () => {
    // A server's voice channels share one audience, so a listener in one
    // call receives every other call's music state too. The room is how a
    // client tells which one is its own.
    const m = make()
    m.create(ROOM, 'Chill', { kind: 'link' as const, url: 'https://x/a.mp3' }, 'ana')
    expect(m.view(ROOM).room).toBe(ROOM)
    expect(m.view('voice:elsewhere')).toEqual({ room: 'voice:elsewhere', channels: [] })
  })
})
