import { describe, it, expect } from 'vitest'
import {
  emptyQueue, start, next, previous, jump, setShuffle, cycleRepeat,
  enqueue, unqueue, drop, upNext, peek, contextTrack,
  type QueueState, type Rng,
} from '../musicQueue'

/**
 * The queue had no tests at all before this file, and it showed: clicking a
 * song in the queue drawer rebuilt the queue from whatever the modal was
 * showing, and shuffle repeated songs and could not go back. Both were
 * invisible to the browser checks that were the only verification it had.
 */

interface T { id: string }
const t = (id: string): T => ({ id })
const A = t('a'), B = t('b'), C = t('c'), D = t('d'), E = t('e')
const LIST = [A, B, C, D, E]
const LIB = { key: 'library', label: 'All tracks' }

/** Deterministic, so a shuffle test fails the same way every time. */
const seeded = (seed: number): Rng => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}
const rng = seeded(42)

const ids = (xs: (T | null)[]) => xs.map(x => x?.id ?? null)
const begin = (index = 0, s: QueueState<T> = emptyQueue<T>()) => start(s, LIST, LIB, index, rng).state

/** Press next until it stops, collecting what played. */
const playThrough = (s: QueueState<T>, max = 50): string[] => {
  const heard = [s.current!.id]
  for (let i = 0; i < max; i++) {
    const r = next(s, 'ended', rng)
    if (r.action !== 'play') break
    heard.push(r.track!.id)
    s = r.state
  }
  return heard
}

describe('starting', () => {
  it('plays the clicked track, in natural order', () => {
    const r = start(emptyQueue<T>(), LIST, LIB, 2, rng)
    expect(r.track).toBe(C)
    expect(r.action).toBe('play')
    expect(r.state.order).toEqual([0, 1, 2, 3, 4])
    expect(r.state.pos).toBe(2)
  })

  it('with shuffle on, plays the clicked track first and shuffles the rest', () => {
    const s = { ...emptyQueue<T>(), shuffle: true }
    const r = start(s, LIST, LIB, 3, rng)
    expect(r.track).toBe(D)
    expect(r.state.order[0]).toBe(3)
    expect([...r.state.order].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps the songs you queued when a new context starts', () => {
    const s = enqueue(begin(), E, 'last')
    const r = start(s, [B, C], { key: 'playlist:x', label: 'X' }, 0, rng)
    expect(ids(r.state.manual)).toEqual(['e'])
  })

  it('does nothing for an index that is not in the list', () => {
    expect(start(emptyQueue<T>(), LIST, LIB, 9, rng).action).toBe('stop')
    expect(start(emptyQueue<T>(), [], LIB, 0, rng).action).toBe('stop')
  })
})

describe('next', () => {
  it('moves forward through the list', () => {
    const r = next(begin(1), 'skip', rng)
    expect(r.track).toBe(C)
    expect(r.state.pos).toBe(2)
  })

  it('plays the manual queue first, without moving the list position', () => {
    const s = enqueue(enqueue(begin(0), E, 'last'), D, 'last')
    const r1 = next(s, 'ended', rng)
    expect(r1.track).toBe(E)
    expect(r1.state.fromManual).toBe(true)
    expect(r1.state.pos).toBe(0)

    const r2 = next(r1.state, 'ended', rng)
    expect(r2.track).toBe(D)
    // Then the list carries on from where it was.
    const r3 = next(r2.state, 'ended', rng)
    expect(r3.track).toBe(B)
    expect(r3.state.fromManual).toBe(false)
  })

  it('at the end with repeat off, cues the first track instead of doing nothing', () => {
    const r = next(begin(4), 'ended', rng)
    expect(r.action).toBe('cue')
    expect(r.track).toBe(A)
  })

  it('at the end with repeat all, goes round again', () => {
    const s = { ...begin(4), repeat: 'all' as const }
    const r = next(s, 'ended', rng)
    expect(r.action).toBe('play')
    expect(r.track).toBe(A)
  })

  it('repeat one replays a track that ended', () => {
    const s = { ...begin(2), repeat: 'one' as const }
    const r = next(s, 'ended', rng)
    expect(r.action).toBe('restart')
    expect(r.track).toBe(C)
  })

  it('repeat one still moves on when you press next', () => {
    // A next button that replays the same song is a button that does nothing.
    const s = { ...begin(2), repeat: 'one' as const }
    const r = next(s, 'skip', rng)
    expect(r.action).toBe('play')
    expect(r.track).toBe(D)
  })
})

describe('previous', () => {
  it('restarts the song when you are past the first few seconds', () => {
    const r = previous(begin(3), 42)
    expect(r.action).toBe('restart')
    expect(r.track).toBe(D)
  })

  it('goes to the song before, near the start', () => {
    const r = previous(begin(3), 1)
    expect(r.action).toBe('play')
    expect(r.track).toBe(C)
  })

  it('restarts the first song rather than doing nothing', () => {
    expect(previous(begin(0), 1).action).toBe('restart')
  })

  it('wraps to the last song when repeating the list', () => {
    const r = previous({ ...begin(0), repeat: 'all' }, 1)
    expect(r.track).toBe(E)
  })

  it('from a manual item, returns to where the list was', () => {
    const s = enqueue(begin(1), E, 'next')
    const onManual = next(s, 'ended', rng).state
    expect(onManual.current).toBe(E)
    const r = previous(onManual, 1)
    expect(r.track).toBe(B)
    expect(r.state.fromManual).toBe(false)
  })
})

describe('jumping from the queue drawer', () => {
  it('moves the position and changes NOTHING else', () => {
    // The bug that started the rewrite: this used to rebuild the queue from
    // whatever list the modal was showing at the time.
    const s = begin(0)
    const r = jump(s, { kind: 'context', orderIndex: 3 })
    expect(r.track).toBe(D)
    expect(r.state.context).toEqual(s.context)
    expect(r.state.tracks).toEqual(s.tracks)
    expect(r.state.order).toEqual(s.order)
    expect(r.state.pos).toBe(3)
  })

  it('keeps the shuffled order when jumping inside it', () => {
    const s = setShuffle(begin(0), true, rng)
    const target = upNext(s).context[2]
    const r = jump(s, { kind: 'context', orderIndex: target.orderIndex })
    expect(r.track).toBe(target.track)
    expect(r.state.order).toEqual(s.order)
  })

  it('takes a manual item out and keeps the others queued', () => {
    const s = [C, D, E].reduce((q, x) => enqueue(q, x, 'last'), begin(0))
    const r = jump(s, { kind: 'manual', index: 1 })
    expect(r.track).toBe(D)
    expect(ids(r.state.manual)).toEqual(['c', 'e'])
    expect(r.state.fromManual).toBe(true)
  })
})

describe('shuffle', () => {
  it('plays every song exactly once before any repeats', () => {
    const s = start({ ...emptyQueue<T>(), shuffle: true }, LIST, LIB, 0, rng).state
    const heard = playThrough(s)
    expect(heard).toHaveLength(5)
    expect(new Set(heard).size).toBe(5)
  })

  it('previous walks back through the order you actually heard', () => {
    let s = start({ ...emptyQueue<T>(), shuffle: true }, LIST, LIB, 0, rng).state
    const heard = [s.current!.id]
    for (let i = 0; i < 3; i++) { s = next(s, 'skip', rng).state; heard.push(s.current!.id) }
    for (let i = 3; i > 0; i--) {
      s = previous(s, 0).state
      expect(s.current!.id).toBe(heard[i - 1])
    }
  })

  it('turning it on keeps the song that is playing', () => {
    const s = setShuffle(begin(2), true, rng)
    expect(s.current).toBe(C)
    expect(contextTrack(s)).toBe(C)
    expect(s.order[s.pos]).toBe(2)
  })

  it('turning it off continues with the song that naturally follows', () => {
    let s = setShuffle(begin(0), true, rng)
    s = next(s, 'skip', rng).state
    const playing = s.current!
    s = setShuffle(s, false, rng)
    expect(s.order).toEqual([0, 1, 2, 3, 4])
    expect(s.current).toBe(playing)
    const after = next(s, 'skip', rng).track
    expect(after).toBe(LIST[LIST.indexOf(playing) + 1] ?? A)
  })

  it('reshuffles at the wrap without replaying the song that just ended', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = seeded(seed)
      let s = start({ ...emptyQueue<T>(), shuffle: true, repeat: 'all' }, LIST, LIB, 0, r).state
      for (let i = 0; i < 4; i++) s = next(s, 'ended', r).state
      const last = s.current
      const wrapped = next(s, 'ended', r)
      expect(wrapped.track).not.toBe(last)
    }
  })

  it('is just a flag before anything has played', () => {
    const s = setShuffle(emptyQueue<T>(), true, rng)
    expect(s.shuffle).toBe(true)
    expect(s.order).toEqual([])
  })
})

describe('repeat', () => {
  it('cycles off, all, one', () => {
    let s = emptyQueue<T>()
    s = cycleRepeat(s); expect(s.repeat).toBe('all')
    s = cycleRepeat(s); expect(s.repeat).toBe('one')
    s = cycleRepeat(s); expect(s.repeat).toBe('off')
  })
})

describe('the manual queue', () => {
  it('play next goes to the front, add to queue to the back', () => {
    let s = enqueue(begin(), C, 'last')
    s = enqueue(s, D, 'last')
    s = enqueue(s, E, 'next')
    expect(ids(s.manual)).toEqual(['e', 'c', 'd'])
  })

  it('removes by position, so a song queued twice can be told apart', () => {
    let s = enqueue(enqueue(enqueue(begin(), C, 'last'), D, 'last'), C, 'last')
    s = unqueue(s, 0)
    expect(ids(s.manual)).toEqual(['d', 'c'])
  })
})

describe('a deleted track', () => {
  it('comes out of the list, and next lands on the song that slid into the gap', () => {
    const s = drop(begin(1), 'c')
    expect(ids(s.tracks)).toEqual(['a', 'b', 'd', 'e'])
    expect(next(s, 'skip', rng).track).toBe(D)
  })

  it('comes out of the manual queue too', () => {
    const s = drop(enqueue(begin(), C, 'last'), 'c')
    expect(s.manual).toEqual([])
  })

  it('empties current when it was the one playing', () => {
    const s = drop(begin(2), 'c')
    expect(s.current).toBeNull()
    // And the list carries on with what came after it.
    expect(next(s, 'skip', rng).track).toBe(D)
  })

  it('removes every copy of a song that appears twice', () => {
    const twice = start(emptyQueue<T>(), [A, B, A, C], LIB, 0, rng).state
    const s = drop(twice, 'a')
    expect(ids(s.tracks)).toEqual(['b', 'c'])
    expect(s.order).toEqual([0, 1])
  })

  it('keeps a shuffled order consistent', () => {
    const s = drop(setShuffle(begin(0), true, rng), 'd')
    expect([...s.order].sort()).toEqual([0, 1, 2, 3])
    expect(s.order.every(i => s.tracks[i].id !== 'd')).toBe(true)
  })
})

describe('reading the queue', () => {
  it('shows the manual queue, then the rest of the list', () => {
    const s = enqueue(begin(2), A, 'last')
    const u = upNext(s)
    expect(ids(u.manual)).toEqual(['a'])
    expect(ids(u.context.map(c => c.track))).toEqual(['d', 'e'])
  })

  it('shows a shuffled order as it will actually play', () => {
    let s = setShuffle(begin(0), true, rng)
    const shown = ids(upNext(s).context.map(c => c.track))
    const played: (string | null)[] = []
    for (let i = 0; i < shown.length; i++) { s = next(s, 'skip', rng).state; played.push(s.current!.id) }
    expect(played).toEqual(shown)
  })

  it('prefetches the song that really plays next, in every mode', () => {
    // peek decides what gets downloaded early; if it disagrees with next(),
    // the wrong file is fetched and the right one still has a gap.
    const modes = [
      { shuffle: false, repeat: 'off' }, { shuffle: false, repeat: 'all' },
      { shuffle: false, repeat: 'one' }, { shuffle: true, repeat: 'off' },
      { shuffle: true, repeat: 'one' },
    ] as const
    for (const m of modes) {
      for (let startAt = 0; startAt < LIST.length; startAt++) {
        let s = start({ ...emptyQueue<T>(), ...m }, LIST, LIB, startAt, rng).state
        s = enqueue(s, E, 'next')
        for (let step = 0; step < 8; step++) {
          const predicted = peek(s)
          const r = next(s, 'ended', rng)
          if (predicted) expect(r.track?.id).toBe(predicted.id)
          s = r.state
        }
      }
    }
  })
})
