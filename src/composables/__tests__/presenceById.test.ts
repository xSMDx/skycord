/**
 * Live presence for other people.
 *
 * The bug this exists to fix: `onPresence` updated exactly two places — the
 * friends list and the DM sidebar — by finding the user in each array and
 * writing `status` onto their copy. Group members render a status dot from
 * their own copy, which nothing ever wrote to, so a group member's status was
 * frozen at whatever it was when the group loaded. Someone could go offline
 * and their dot stayed green for as long as you had the group open.
 *
 * The shape was the real problem, not the missing line. Every surface holding
 * its own copy means the handler has to remember each one, and the next
 * surface — the server member list — would have been missed the same way.
 *
 * So: one map, written once, read by everyone. A new surface gets live
 * presence by asking, not by being remembered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// usePresence reads localStorage at module load for the idle-timeout setting,
// and the node test environment has none.
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
})

const { applyPresence, livePresence, presenceById, resetPresenceMap } =
  await import('../usePresence')

describe('live presence for other users', () => {
  beforeEach(() => resetPresenceMap())

  it('remembers a status that arrived over the wire', () => {
    applyPresence('u1', 'idle')
    expect(livePresence('u1', 'online')).toBe('idle')
  })

  it('falls back to the loaded status for someone no event has mentioned', () => {
    // A member list is fetched with statuses attached. Until an event says
    // otherwise, that fetched value is the best thing we know.
    expect(livePresence('never-seen', 'dnd')).toBe('dnd')
  })

  it('treats a later event as the truth', () => {
    applyPresence('u1', 'online')
    applyPresence('u1', 'offline')
    expect(livePresence('u1', 'online')).toBe('offline')
  })

  it('a live status beats the loaded one even when the loaded one is newer-looking', () => {
    // The fallback is only a fallback. Once an event has spoken for a user,
    // a stale fetched value must never win — that is the whole bug.
    applyPresence('u1', 'offline')
    expect(livePresence('u1', 'online')).toBe('offline')
  })

  it('keeps users separate', () => {
    applyPresence('u1', 'dnd')
    applyPresence('u2', 'idle')
    expect(livePresence('u1', 'online')).toBe('dnd')
    expect(livePresence('u2', 'online')).toBe('idle')
  })

  it('defaults to offline when there is no live value and no fallback', () => {
    expect(livePresence('nobody')).toBe('offline')
  })

  it('is reactive — the map is a ref surfaces can depend on', () => {
    applyPresence('u1', 'idle')
    expect(presenceById.value['u1']).toBe('idle')
  })

  it('resetPresenceMap clears it, so a new session inherits nothing', () => {
    applyPresence('u1', 'idle')
    resetPresenceMap()
    expect(presenceById.value).toEqual({})
    expect(livePresence('u1', 'online')).toBe('online')
  })

  it('ignores a status string it does not recognise rather than rendering it', () => {
    // The server serialises through effectiveStatus, so this should be
    // impossible — but a status that reaches the UI unrecognised renders as a
    // grey dot labelled with the literal word, which is how "invisible" once
    // leaked into the UI as a visible state.
    applyPresence('u1', 'banana' as any)
    expect(livePresence('u1', 'online')).toBe('online')
  })
})
