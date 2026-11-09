import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'

/**
 * What the Android app asks of the page: open a conversation, join a call.
 *
 * Read from the source, as chatAppGates.test.ts does, because each of these is
 * one decision at a call site inside a view that cannot be mounted here. The
 * behaviour behind the Escape loop is tested where it lives (androidBack.test).
 */

/** The source from `start` up to the next occurrence of `end`. */
const between = (start: string, end: string): string => {
  const from = source.indexOf(start)
  expect(from, `"${start}" is in ChatApp.vue`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('the delete-confirm preview', () => {
  it('collapses whitespace, not the letter s', () => {
    // \s+ with its backslash dropped is /s+/: "classes" would read "clases".
    expect(source).not.toMatch(/\.replace\(\/s\+\//)
    // previewText: a message sent as files alone still has words to show.
    expect(source).toContain('stripMarkers(previewText(msg)).replace(/\\s+/g, " ")')
  })
})

describe('opening a conversation from the app', () => {
  const open = between('const openFromApp = async', 'const stopOpenFromApp')

  it('closes what is open by waiting for each box to go, not by re-sending Escape after a tick', () => {
    // A dialog stays in the page through its leave transition, so a loop that
    // looks again after one tick finds it still on top.
    expect(open).toContain('await closeOverlays()')
    expect(open).not.toContain('pressEscape')
    expect(open).not.toContain('nextTick')
  })

  it('can leave the missing-conversation toast to its caller', () => {
    expect(open).toMatch(/opts\.quiet/)
    expect(open).toContain('return opened')
  })
})

describe('joining a call from the app', () => {
  const join = between('const joinFromApp = async', 'const stopJoinFromApp')
  const request = between('onJoinCall?.(c => {', 'void joinFromApp(c)')

  it('starts the guard\'s safety timer when the call is made, after the boot wait', () => {
    expect(join.indexOf('await whenBooted()')).toBeGreaterThan(-1)
    expect(join.indexOf('armJoiningTimer()')).toBeGreaterThan(join.indexOf('await whenBooted()'))
    expect(join.indexOf('armJoiningTimer()')).toBeLessThan(join.indexOf('vConnect('))
  })

  it('does not start it when the request arrives', () => {
    // The guard itself is raised here, at once; its clock is not.
    expect(request).toContain('joiningFromApp.value =')
    expect(request).not.toContain('setTimeout')
    expect(request).not.toContain('armJoiningTimer')
  })

  it('keeps the missing-conversation toast quiet while the join stands', () => {
    // A DM that is not in the list can still be joined.
    expect(join).toContain('{ quiet: true }')
    expect(join).toMatch(/if \(!opened && failed\) showToast/)
  })
})
