/// <reference types="node" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MusicRooms, EMPTY_GRACE_MS } from '../sockets/musicState'
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
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
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
    m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana')
    expect(m.view(ROOM).channels[0].listeners).toEqual([])
  })

  it('refuses past the per-call cap', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, 'https://x/a.mp3', 'ana')
    const r = m.create(ROOM, 'one too many', 'https://x/a.mp3', 'ana')
    expect(r.ok).toBe(false)
  })

  it('refuses past the instance cap even when this room has space', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, 'https://x/a.mp3', 'ana')
    expect(m.create(OTHER, 'first here', 'https://x/a.mp3', 'ben').ok).toBe(true)   // 4th overall
    const r = m.create(OTHER, 'fifth', 'https://x/a.mp3', 'ben')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('server')
  })

  it('counts channels across rooms, not just the one asked about', () => {
    const m = make()
    m.create(ROOM, 'a', 'https://x/a.mp3', 'ana')
    m.create(OTHER, 'b', 'https://x/a.mp3', 'ben')
    expect(m.channelsHere(ROOM)).toBe(1)
    expect(m.channelsEverywhere()).toBe(2)
  })
})

describe('queueing and skipping', () => {
  it('queues behind what is playing', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/1.mp3', 'ana'))
    expect(m.queue(ROOM, id, 'https://x/2.mp3', 'ben').ok).toBe(true)
    const v = m.view(ROOM).channels[0]
    expect(v.now?.url).toBe('https://x/1.mp3')
    expect(v.queued).toBe(1)
  })

  it('refuses a full queue', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/1.mp3', 'ana'))
    expect(m.queue(ROOM, id, 'https://x/2.mp3', 'ben').ok).toBe(true)
    expect(m.queue(ROOM, id, 'https://x/3.mp3', 'ben').ok).toBe(true)
    expect(m.queue(ROOM, id, 'https://x/4.mp3', 'ben').ok).toBe(false)
  })

  it('skip advances to the next track', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/1.mp3', 'ana'))
    m.queue(ROOM, id, 'https://x/2.mp3', 'ben')
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
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/1.mp3', 'ana'))
    m.listen(ROOM, 'ana', id)
    expect(m.skip(ROOM, id).now).toBeNull()
    expect(m.view(ROOM).channels).toHaveLength(1)
    expect(m.view(ROOM).channels[0].now).toBeNull()
  })

  it('refuses to queue or skip a channel that is gone', () => {
    const m = make()
    expect(m.queue(ROOM, 'nope', 'https://x/a.mp3', 'ana').ok).toBe(false)
    expect(m.skip(ROOM, 'nope').ok).toBe(false)
  })
})

describe('listening', () => {
  it('tunes a member in', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    expect(m.listen(ROOM, 'ana', id).ok).toBe(true)
    expect(m.view(ROOM).channels[0].listeners).toEqual(['ana'])
  })

  it('moves a member between channels rather than adding them to both', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    const b = idOf(m.create(ROOM, 'Metal', 'https://x/b.mp3', 'ben'))
    m.listen(ROOM, 'ana', a)
    m.listen(ROOM, 'ana', b)
    const v = m.view(ROOM).channels
    expect(v.find(c => c.id === a)!.listeners).toEqual([])
    expect(v.find(c => c.id === b)!.listeners).toEqual(['ana'])
  })

  it('null tunes out of everything', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
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
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    m.listen(ROOM, 'ana', id); m.listen(ROOM, 'ben', id)
    expect(m.view(ROOM).channels[0].listeners.sort()).toEqual(['ana', 'ben'])
  })
})

describe('the empty-channel grace period', () => {
  it('a channel nobody ever joined is torn down after the grace period', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    expect(m.closePending(ROOM, id)).toBe(true)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed).toEqual([`${ROOM}/${id}`])
  })

  it('is cancelled the moment somebody listens', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
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
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
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
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    m.listen(ROOM, 'ana', id)
    m.listen(ROOM, 'ana', null)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed).toEqual([`${ROOM}/${id}`])
  })

  it('arms only once, so a flapping listener does not stack timers', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    for (let i = 0; i < 5; i++) { m.listen(ROOM, 'ana', id); m.listen(ROOM, 'ana', null) }
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)
    expect(closed).toEqual([`${ROOM}/${id}`])   // exactly one teardown, not five
  })
})

describe('members leaving', () => {
  it('forget drops a member from every channel and names the rooms that changed', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    const b = idOf(m.create(OTHER, 'Metal', 'https://x/b.mp3', 'ben'))
    m.listen(ROOM, 'ana', a)
    m.listen(OTHER, 'ana', b)
    const touched = m.forget('ana')
    expect(touched.sort()).toEqual([ROOM, OTHER].sort())
    expect(m.view(ROOM).channels[0].listeners).toEqual([])
  })

  it('forget names no room when the member was listening to nothing', () => {
    const m = make()
    m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana')
    expect(m.forget('nobody')).toEqual([])
  })

  it('closeRoom tears everything down at once', () => {
    const m = make()
    const a = idOf(m.create(ROOM, 'a', 'https://x/a.mp3', 'ana'))
    const b = idOf(m.create(ROOM, 'b', 'https://x/b.mp3', 'ana'))
    m.closeRoom(ROOM)
    expect(m.view(ROOM).channels).toHaveLength(0)
    expect(closed.sort()).toEqual([`${ROOM}/${a}`, `${ROOM}/${b}`].sort())
  })

  it('frees the room slot so a new channel can be made after teardown', () => {
    const m = make()
    for (let i = 0; i < 3; i++) m.create(ROOM, `c${i}`, 'https://x/a.mp3', 'ana')
    expect(m.create(ROOM, 'full', 'https://x/a.mp3', 'ana').ok).toBe(false)
    vi.advanceTimersByTime(EMPTY_GRACE_MS + 10)       // all three were empty
    expect(m.channelsEverywhere()).toBe(0)
    expect(m.create(ROOM, 'room again', 'https://x/a.mp3', 'ana').ok).toBe(true)
  })
})

describe('shutdown', () => {
  it('cancelAllCloses concludes nothing', () => {
    const m = make()
    const id = idOf(m.create(ROOM, 'Chill', 'https://x/a.mp3', 'ana'))
    m.cancelAllCloses()
    vi.advanceTimersByTime(EMPTY_GRACE_MS * 3)
    // The process is going away; a channel it stops tracking is not a channel
    // that ended. Same reasoning as cancelAllCallEnds.
    expect(closed).toEqual([])
    expect(m.view(ROOM).channels).toHaveLength(1)
    expect(m.get(ROOM, id)).toBeDefined()
  })
})
