import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runBulk, type Refused } from '../bulkRun'

/**
 * A bulk delete, or a bulk Remove from playlist, one row at a time under the
 * app-wide limit. A 429 is the limit, not the row: wait as long as it says,
 * then the same row again. Anything else fails that row alone.
 */

const limited = (retryAfter = '2'): Refused => ({ ok: false, status: 429, headers: { 'Retry-After': retryAfter }, message: 'Too many requests' })
const refused = (message: string): Refused => ({ ok: false, status: 404, headers: {}, message })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('runBulk', () => {
  it('acts on each row in order, one at a time, and says how each went', async () => {
    const order: string[] = []
    const settled: [string, string | null][] = []
    const reached = await runBulk(['a', 'b', 'c'], async (r) => {
      order.push(r)
      return r === 'b' ? refused('Not found') : null
    }, { signal: new AbortController().signal, settled: (r, f) => settled.push([r, f]) })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(settled).toEqual([['a', null], ['b', 'Not found'], ['c', null]])
    expect(reached).toBe(3)
  })

  it('waits out a 429 as long as it says, then tries the same row again', async () => {
    const tries: string[] = []
    const waits: (number | null)[] = []
    const settled: [string, string | null][] = []
    let first = true
    const run = runBulk(['a', 'b'], async (r) => {
      tries.push(r)
      if (r === 'a' && first) { first = false; return limited('2') }
      return null
    }, {
      signal: new AbortController().signal,
      settled: (r, f) => settled.push([r, f]),
      waiting: until => waits.push(until),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(tries).toEqual(['a'])
    expect(waits).toEqual([Date.now() + 2000])
    expect(settled).toEqual([])
    await vi.advanceTimersByTimeAsync(1999)
    expect(tries).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(1)
    expect(await run).toBe(2)
    expect(tries).toEqual(['a', 'a', 'b'])
    expect(waits.at(-1)).toBeNull()
    // The 429 was never the row's: it went, and says nothing of the limit.
    expect(settled).toEqual([['a', null], ['b', null]])
  })

  it('reads the wait from RateLimit-Reset when there is no Retry-After', async () => {
    const waits: (number | null)[] = []
    let n = 0
    const run = runBulk(['a'], async () => (n++ ? null : { ok: false as const, status: 429, headers: { 'RateLimit-Reset': '5' }, message: '' }), {
      signal: new AbortController().signal, settled: () => {}, waiting: u => waits.push(u),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(waits[0]).toBe(Date.now() + 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await run).toBe(1)
  })

  it('stopping during the wait ends it at once, leaves that row unreached, and leaves no timer', async () => {
    const stop = new AbortController()
    const tries: string[] = []
    const settled: string[] = []
    const run = runBulk(['a', 'b'], async (r) => { tries.push(r); return limited('60') }, {
      signal: stop.signal, settled: r => settled.push(r), waiting: () => {},
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    stop.abort()
    expect(await run).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(tries).toEqual(['a'])
    expect(settled).toEqual([])
  })

  it('stopping between rows stops before the next one', async () => {
    const stop = new AbortController()
    const tries: string[] = []
    const reached = await runBulk(['a', 'b', 'c'], async (r) => { tries.push(r); if (r === 'a') stop.abort(); return null }, {
      signal: stop.signal, settled: () => {},
    })
    expect(tries).toEqual(['a'])
    expect(reached).toBe(1)
  })

  it('stopped before it starts, it does nothing', async () => {
    const stop = new AbortController()
    stop.abort()
    const act = vi.fn(async () => null)
    expect(await runBulk(['a'], act, { signal: stop.signal, settled: () => {} })).toBe(0)
    expect(act).not.toHaveBeenCalled()
  })

  it('removing by place, highest first, takes exactly the picked rows with no reload between them', async () => {
    // A playlist on the server, removed from by index, as removeFromPlaylist does.
    const server = ['a', 'b', 'a', 'c', 'd']
    const picked = [{ i: 0, id: 'a' }, { i: 2, id: 'a' }, { i: 3, id: 'c' }]
    const order = [...picked].sort((x, y) => y.i - x.i)
    let limitedOnce = false
    const run = runBulk(order, async (r) => {
      // The limit hits halfway: the same place is tried again, still right.
      if (r.i === 2 && !limitedOnce) { limitedOnce = true; return limited('1') }
      expect(server[r.i]).toBe(r.id)
      server.splice(r.i, 1)
      return null
    }, { signal: new AbortController().signal, settled: () => {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await run).toBe(3)
    expect(server).toEqual(['b', 'd'])
  })
})
