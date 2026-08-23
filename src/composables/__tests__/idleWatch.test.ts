/**
 * When you count as away.
 *
 * Two faults, both reported from real use. Hiding the tab went idle
 * *immediately* — not after the delay you configured, instantly — so
 * alt-tabbing for ten seconds told everyone you had left. And nothing
 * distinguished "not touching this tab" from "not here": you could be talking
 * in a voice call, mid-sentence, and be marked away while people listened.
 *
 * What a browser tab can and cannot know matters here. It sees its own mouse
 * and keyboard, and whether it is visible. It cannot see whether you are
 * clicking in another window, or that a game is running — browsers withhold
 * that on purpose, since a page that could watch your OS would be a
 * surveillance tool. So the fix is not better snooping; it is refusing to
 * claim more than the tab can actually support, and letting a voice call speak
 * for you when it can.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const emitted: { away: boolean }[] = []
vi.mock('../useSocket', () => ({
  getSocket: () => ({ emit: (_ev: string, p: { away: boolean }) => { emitted.push(p) } }),
}))
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
})
// The idle watcher listens on window and document. The node environment has
// neither, and the point here is the timing logic, not the event plumbing —
// so they are stubs that record nothing.
vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
vi.stubGlobal('document', {
  hidden: false,
  addEventListener: () => {}, removeEventListener: () => {},
  // Vue's runtime-dom probes document at import time; without this the whole
  // suite fails to load before a single test runs.
  createElement: () => ({ style: {} }),
})

const { holdPresence, startIdleWatch, stopIdleWatch, setIdleMinutes } =
  await import('../usePresence')

const lastAway = () => emitted.length ? emitted[emitted.length - 1].away : null

describe('idle detection', () => {
  beforeEach(() => {
    emitted.length = 0
    vi.useFakeTimers()
    // presenceHeld is module state with no reset of its own — in the app the
    // watcher on voice.connected keeps it honest, but here it would leak from
    // whichever test last held a call open and silently suppress the next
    // one's idle.
    holdPresence(false)
    emitted.length = 0
  })
  afterEach(() => {
    stopIdleWatch()
    vi.useRealTimers()
  })

  // Nothing is sent while the answer is unchanged — the server already
  // assumes you are present, so `null` here means "said nothing", which is
  // different from "said you are here".

  it('goes away only after the configured delay, not the moment you look away', () => {
    setIdleMinutes(5)
    startIdleWatch()

    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(lastAway()).toBeNull()           // four minutes in, nothing claimed

    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(lastAway()).toBe(true)
  })

  it('a voice call vouches for you — the delay can expire and you stay present', () => {
    setIdleMinutes(1)
    startIdleWatch()
    holdPresence(true)

    vi.advanceTimersByTime(10 * 60 * 1000)  // ten minutes of silence

    // You are audibly in a room with people. That is presence, whatever the
    // mouse is doing.
    expect(lastAway()).not.toBe(true)
  })

  it('and stops vouching once the call ends', () => {
    setIdleMinutes(1)
    startIdleWatch()
    holdPresence(true)
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(lastAway()).not.toBe(true)

    holdPresence(false)                     // hung up
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(lastAway()).toBe(true)
  })

  it('taking a call while already idle brings you straight back', () => {
    setIdleMinutes(1)
    startIdleWatch()
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(lastAway()).toBe(true)

    holdPresence(true)
    expect(lastAway()).toBe(false)          // a real transition, so it is sent
  })

  it('does not spam the socket while nothing changes', () => {
    setIdleMinutes(1)
    startIdleWatch()
    vi.advanceTimersByTime(5 * 60 * 1000)   // idles once...
    vi.advanceTimersByTime(5 * 60 * 1000)   // ...then just sits there
    expect(emitted.filter(e => e.away).length).toBe(1)
  })
})
