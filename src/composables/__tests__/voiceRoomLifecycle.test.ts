/**
 * Forgetting a voice room.
 *
 * The bug: deleting an occupied voice channel left a rail badge lit for the
 * rest of the session, and hovering that server showed a preview naming an
 * occupant who had long since left.
 *
 * The reason is a gap in the `call:state` stream that only opened once voice
 * activity got a render surface. Deleting a channel empties its `chan:<id>`
 * socket room as part of the delete. So when the last occupant leaves
 * afterwards, the server dutifully broadcasts "this room is now empty" — to a
 * room with nobody in it. No client ever hears it, and `call:state` is the
 * only thing that clears occupancy.
 *
 * That used to be survivable by accident. `voiceActivityByServer` could not
 * name a server for a channel that had left `channelsByServer`, so the stale
 * entry was skipped and nothing rendered. Attribution now arrives on the wire
 * and is remembered independently of the local channel list — which is exactly
 * what makes the badge work for servers you have never opened, and exactly
 * what removes the accidental self-heal.
 *
 * So the client has to close the room itself when it learns the channel is
 * gone. These tests pin that contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// useSocket pulls in useAuth, which reads localStorage at module load.
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
})

const { activeCalls, voiceRoomServers, forgetVoiceRoom, resetCalls } =
  await import('../useSocket')

describe('forgetVoiceRoom', () => {
  beforeEach(() => {
    activeCalls.value      = {}
    voiceRoomServers.value = {}
  })

  it('drops occupancy and attribution together', () => {
    activeCalls.value      = { 'voice:c1': ['u1'] }
    voiceRoomServers.value = { 'voice:c1': 's1' }

    forgetVoiceRoom('c1')

    // Either one surviving alone is enough to keep the badge lit: the
    // attribution map is consulted first, and the occupancy map is the
    // fallback. Both have to go.
    expect(activeCalls.value).toEqual({})
    expect(voiceRoomServers.value).toEqual({})
  })

  it('leaves every other room alone', () => {
    activeCalls.value = {
      'voice:c1': ['u1'],
      'voice:c2': ['u2'],
      'dm:a_b':   ['u3'],   // a DM call is not server activity and is not ours to touch
    }
    voiceRoomServers.value = { 'voice:c1': 's1', 'voice:c2': 's1' }

    forgetVoiceRoom('c1')

    expect(activeCalls.value).toEqual({ 'voice:c2': ['u2'], 'dm:a_b': ['u3'] })
    expect(voiceRoomServers.value).toEqual({ 'voice:c2': 's1' })
  })

  it('is a no-op for a channel nobody was in', () => {
    // channel:deleted fires for text channels too, and for voice channels
    // that were empty — by far the common case. It must not throw, and it
    // must not disturb anything.
    activeCalls.value      = { 'voice:c2': ['u2'] }
    voiceRoomServers.value = { 'voice:c2': 's1' }

    expect(() => forgetVoiceRoom('c-never-used')).not.toThrow()
    expect(activeCalls.value).toEqual({ 'voice:c2': ['u2'] })
    expect(voiceRoomServers.value).toEqual({ 'voice:c2': 's1' })
  })

  it('clears an entry the wire could still name, not just an orphaned one', () => {
    // The dangerous shape specifically: the server told us which server this
    // room belongs to, so the badge does NOT depend on the local channel list
    // and cannot be fixed by removing the channel from it.
    voiceRoomServers.value = { 'voice:c1': 's1' }
    activeCalls.value      = { 'voice:c1': ['u1'] }

    forgetVoiceRoom('c1')

    expect('voice:c1' in voiceRoomServers.value).toBe(false)
  })
})

describe('resetCalls', () => {
  it('clears everything, so the next account on this device inherits nothing', () => {
    // Logging out swaps the shell for the auth page without a page reload, so
    // module state survives the seam. resetServers and resetPresenceMap are
    // called at that same point for exactly this reason; these two were
    // missed because until the rail badge existed, no surface rendered a call
    // the viewer was not a participant in.
    activeCalls.value      = { 'voice:c1': ['u1'], 'group:g1': ['u2'] }
    voiceRoomServers.value = { 'voice:c1': 's1' }

    resetCalls()

    expect(activeCalls.value).toEqual({})
    expect(voiceRoomServers.value).toEqual({})
  })
})
