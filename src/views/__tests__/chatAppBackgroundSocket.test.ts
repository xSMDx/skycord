import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'

/**
 * The page's own socket in the Android background, as ChatApp wires it.
 *
 * The decisions and the timing are tested in backgroundSocket.test.ts and the
 * strip's silence in useSocket.rest.test.ts. What is left is wiring inside a
 * view that cannot be mounted here, so it is read from the source, as
 * chatAppFromApp.test.ts does.
 */
const between = (start: string, end: string): string => {
  const from = source.indexOf(start)
  expect(from, `"${start}" is in ChatApp.vue`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('resting the socket in the background', () => {
  const wiring = between('let pendingCatchUp', 'onBeforeUnmount(() => backgroundSocket.stop())')

  it('is told the platform, so Windows and a browser never rest', () => {
    expect(wiring).toContain('platform: appBridge()?.platform')
  })

  it('rests with useSocket.rest (the strip stays quiet), not disconnect', () => {
    expect(wiring).toContain('rest: socketRest')
    expect(wiring).not.toContain('rest: socketDisconnect')
  })

  it('counts connecting and the join from the app as being in a call', () => {
    expect(wiring).toContain('voice.connected || voice.connecting || joiningFromApp.value !== null')
  })

  it('syncs on every change, synchronously, so an answer from the app has its socket for the first emit', () => {
    expect(wiring).toMatch(/watch\(\[backgrounded, socketNeededForCall\][\s\S]*flush: 'sync'/)
  })

  it('notes where the open conversation stood before the new socket exists', () => {
    const wake = between('wake: () => {', 'socketConnect()')
    expect(wake).toContain('pendingCatchUp = {')
  })

  it('tops the conversation up once the new socket is up, not before', () => {
    expect(wiring).toMatch(/watch\(socketConnected, up => \{\s*if \(!up \|\| !pendingCatchUp\) return/)
    expect(wiring).toContain('catchUpConversation(c, anchor)')
  })
})

/**
 * What the page believes about calls after its socket has been away.
 *
 * `call:state` only says what changed, and the server's connect-time catch-up
 * skips an empty room, so a call that ended while the socket rested was never
 * heard to end: it stayed in `activeCalls` and rang on return (Accept joined an
 * empty room). The answer is to forget the calls before the new socket exists,
 * since the catch-up names every room still occupied.
 */
describe('calls after a rest', () => {
  const wake = between('wake: () => {', 'socketConnect()')

  it('forgets every call before the new socket exists', () => {
    expect(wake).toContain('forgetCallsForWake()')
    // ...and the helper is what clears them, through the one reset that also
    // empties the voice states and room attribution.
    const helper = between('const forgetCallsForWake', 'wake: () => {')
    expect(helper).toContain('resetCalls()')
  })

  it('leaves the calls alone when I am in one, though the socket never rests then', () => {
    expect(wake).toMatch(/if \(!voice\.connected && !voice\.connecting\) forgetCallsForWake\(\)/)
  })

  it('keeps the declined and left marks while the catch-up lands, then prunes them', () => {
    // Forgetting the calls would otherwise prune every mark at once (the watch
    // on activeCalls drops a mark whose room is gone), and the catch-up would
    // ring a call that was declined or left minutes ago and is still going.
    const prune = between('const pruneCallMarks', 'watch(activeCalls')
    expect(prune).toContain('dismissedCallRooms')
    expect(prune).toContain('engagedCallRooms')
    expect(prune).toContain('modalAckedRooms')
    expect(source).toMatch(/watch\(activeCalls, cur => \{\s*if \(callsRelearning === null\) pruneCallMarks\(cur\)/)
    const helper = between('const forgetCallsForWake', 'wake: () => {')
    expect(helper).toMatch(/setTimeout\(\(\) => \{[^}]*callsRelearning = null[^}]*pruneCallMarks\(activeCalls\.value\)/)
  })

  it('drops the timer with the view', () => {
    expect(source).toMatch(/onBeforeUnmount\(\(\) => \{ if \(callsRelearning !== null\) clearTimeout\(callsRelearning\) \}\)/)
  })
})
