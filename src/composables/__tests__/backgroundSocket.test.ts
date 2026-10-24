import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BACKGROUND_GRACE_MS, createBackgroundSocket, mergeCaughtUp, shouldRestSocket } from '../backgroundSocket'

describe('when the page lets its own connection go', () => {
  it('is only on Android, in the background, with no call', () => {
    expect(shouldRestSocket('android', true, false)).toBe(true)
  })

  it('never while the app is in front', () => {
    expect(shouldRestSocket('android', false, false)).toBe(false)
    expect(shouldRestSocket('android', false, true)).toBe(false)
  })

  it('never in or joining a call: the call needs the socket', () => {
    expect(shouldRestSocket('android', true, true)).toBe(false)
  })

  it('never on the Windows app or in a browser, whatever they report', () => {
    expect(shouldRestSocket('win32', true, false)).toBe(false)
    expect(shouldRestSocket('darwin', true, false)).toBe(false)
    expect(shouldRestSocket(undefined, true, false)).toBe(false)
  })
})

describe('the background grace', () => {
  let rest: Mock<() => void>
  let wake: Mock<() => void>
  const make = (platform: string | undefined) => createBackgroundSocket({ platform, rest, wake })

  beforeEach(() => {
    vi.useFakeTimers()
    rest = vi.fn<() => void>()
    wake = vi.fn<() => void>()
  })
  afterEach(() => { vi.useRealTimers() })

  it('waits 45 seconds before letting go', () => {
    expect(BACKGROUND_GRACE_MS).toBe(45_000)
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS - 1)
    expect(rest).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(rest).toHaveBeenCalledTimes(1)
    expect(g.resting()).toBe(true)
  })

  it('does nothing at all if the app is back within the grace, and does not reconnect what never dropped', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(10_000)
    g.sync(false, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS * 2)
    expect(rest).not.toHaveBeenCalled()
    expect(wake).not.toHaveBeenCalled()
    expect(g.resting()).toBe(false)
  })

  it('reconnects when the app comes back after the connection was let go', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    g.sync(false, false)
    expect(wake).toHaveBeenCalledTimes(1)
    expect(g.resting()).toBe(false)
    g.sync(false, false)                      // a repeat says nothing new
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('does not restart the grace on every repeat of the same state', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(30_000)
    g.sync(true, false)
    vi.advanceTimersByTime(15_000)
    expect(rest).toHaveBeenCalledTimes(1)
  })

  it('never lets go while in a call, then starts the grace when the call ends in the background', () => {
    const g = make('android')
    g.sync(true, true)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS * 3)
    expect(rest).not.toHaveBeenCalled()
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(rest).toHaveBeenCalledTimes(1)
  })

  it('cancels the grace when a call begins inside it', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(20_000)
    g.sync(true, true)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(rest).not.toHaveBeenCalled()
  })

  it('reconnects at once when a call starts after the connection was let go (answered from the app)', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    g.sync(true, true)
    expect(wake).toHaveBeenCalledTimes(1)
    expect(g.resting()).toBe(false)
  })

  it('can let go again after coming back', () => {
    const g = make('android')
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    g.sync(false, false)
    g.sync(true, false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(rest).toHaveBeenCalledTimes(2)
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('is inert on the Windows app and in a browser', () => {
    for (const platform of ['win32', undefined]) {
      const g = make(platform)
      g.sync(true, false)
      vi.advanceTimersByTime(BACKGROUND_GRACE_MS * 2)
      g.sync(false, false)
      expect(rest).not.toHaveBeenCalled()
      expect(wake).not.toHaveBeenCalled()
    }
  })

  it('stop() drops a pending grace without letting go', () => {
    const g = make('android')
    g.sync(true, false)
    g.stop()
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS * 2)
    expect(rest).not.toHaveBeenCalled()
  })
})

describe('topping up a conversation after the connection was away', () => {
  const m = (dbId: string | undefined, timestamp: number) => ({ dbId, timestamp })

  it('appends what was missed, below what is there', () => {
    const have = [m('a', 1), m('b', 2)]
    expect(mergeCaughtUp(have, [m('c', 3), m('d', 4)]).map(x => x.dbId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not repeat a message that arrived live meanwhile', () => {
    const have = [m('a', 1), m('c', 3)]
    expect(mergeCaughtUp(have, [m('b', 2), m('c', 3)]).map(x => x.dbId)).toEqual(['a', 'b', 'c'])
  })

  it('puts a missed message above one that arrived live while the page was in flight', () => {
    // m4 came over the new socket before the top-up returned with m2, m3.
    const have = [m('a', 1), m('d', 4)]
    expect(mergeCaughtUp(have, [m('b', 2), m('c', 3), m('d', 4)]).map(x => x.dbId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps a message still being sent at the end', () => {
    const have = [m('a', 1), m(undefined, 99)]
    expect(mergeCaughtUp(have, [m('b', 2)]).map(x => x.dbId)).toEqual(['a', 'b', undefined])
  })

  it('returns the same list when nothing was missed', () => {
    const have = [m('a', 1)]
    expect(mergeCaughtUp(have, [m('a', 1)])).toBe(have)
    expect(mergeCaughtUp(have, [])).toBe(have)
  })
})
