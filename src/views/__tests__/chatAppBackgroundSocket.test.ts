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
