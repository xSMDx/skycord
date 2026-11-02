import { describe, it, expect } from 'vitest'
import { joinProgress, failedCallId, callConversation } from '../callStatus'
import type { ConnectStage } from '../useVoice'

// The shape useVoice keeps while a join is under way: connecting is true for the
// whole retry cycle, the stage walks through the steps, the attempt counts up.
const v = (o: Partial<{ connecting: boolean; connectStage: ConnectStage; connectAttempt: number }> = {}) =>
  ({ connecting: true, connectStage: 'connecting' as ConnectStage, connectAttempt: 1, ...o })

describe('joinProgress', () => {
  it("'failed' → { label: 'Couldn’t connect', failing: true }", () => {
    // useVoice clears connecting and the attempt count before it sets 'failed'.
    expect(joinProgress(v({ connecting: false, connectStage: 'failed', connectAttempt: 0 })))
      .toEqual({ label: 'Couldn’t connect', failing: true })
  })

  it('a failed join reads as failed whatever else is still set', () => {
    expect(joinProgress(v({ connecting: true, connectStage: 'failed', connectAttempt: 3 })))
      .toEqual({ label: 'Couldn’t connect', failing: true })
  })

  it("no-route while connecting → { label: 'No route', failing: true }", () => {
    expect(joinProgress(v({ connectStage: 'no-route' }))).toEqual({ label: 'No route', failing: true })
  })

  it('the red No route flash comes before Trying again, on every retry', () => {
    expect(joinProgress(v({ connectStage: 'no-route', connectAttempt: 3 })))
      .toEqual({ label: 'No route', failing: true })
  })

  it('no-route when not connecting is not a join message: the panel shows call quality then', () => {
    expect(joinProgress(v({ connecting: false, connectStage: 'no-route' }))).toBeNull()
  })

  it("attempt 2 → 'Trying again…'", () => {
    expect(joinProgress(v({ connectAttempt: 2 }))).toEqual({ label: 'Trying again…', failing: false })
  })

  it('Trying again wins over the stage the retry is on', () => {
    expect(joinProgress(v({ connectStage: 'authenticating', connectAttempt: 2 })))
      .toEqual({ label: 'Trying again…', failing: false })
  })

  it.each([
    ['finding-server', 'Finding server…'],
    ['connecting', 'Connecting…'],
    ['authenticating', 'Authenticating…'],
    ['rtc-connecting', 'RTC connecting…'],
  ] as [ConnectStage, string][])("each stage maps to today's label: %s → %s", (connectStage, label) => {
    expect(joinProgress(v({ connectStage }))).toEqual({ label, failing: false })
  })

  it("no stage yet, while connecting → 'Connecting…'", () => {
    expect(joinProgress(v({ connectStage: null }))).toEqual({ label: 'Connecting…', failing: false })
  })

  it('connected → null', () => {
    expect(joinProgress(v({ connecting: false, connectStage: 'connected', connectAttempt: 0 }))).toBeNull()
  })

  it('not in a call at all → null', () => {
    expect(joinProgress(v({ connecting: false, connectStage: null, connectAttempt: 0 }))).toBeNull()
  })
})

// What giveUp leaves behind: connecting and connected are cleared, the stage is
// held at 'failed' until leave() runs, and the ids are kept — connectingConvId
// from the attempt (cleared only by a success or cleanup), activeConvId too
// when the failure was a rejoin of a call that had been up.
const f = (o: Partial<{ connectStage: ConnectStage; connectingConvId: string | null; activeConvId: string | null }> = {}) =>
  ({ connectStage: 'failed' as ConnectStage, connectingConvId: null, activeConvId: null, ...o })

describe('failedCallId', () => {
  it('names the conversation of a first join that failed', () => {
    expect(failedCallId(f({ connectingConvId: 'dm1' }))).toBe('dm1')
  })

  it('names the conversation of a rejoin that failed', () => {
    expect(failedCallId(f({ connectingConvId: 'ch1', activeConvId: 'ch1' }))).toBe('ch1')
  })

  it('falls back to the call that was up when only that is left', () => {
    expect(failedCallId(f({ activeConvId: 'g1' }))).toBe('g1')
  })

  it('is null outside the failed hold, whatever ids are set', () => {
    for (const connectStage of [null, 'connected', 'connecting', 'no-route'] as ConnectStage[]) {
      expect(failedCallId(f({ connectStage, connectingConvId: 'dm1', activeConvId: 'dm1' }))).toBeNull()
    }
  })

  it('is null once leave() has cleared the ids', () => {
    expect(failedCallId(f())).toBeNull()
  })
})

// "Return to call" finds its conversation from the call's id. The group lookup
// used to wait for voice.activeKind === 'group', which only a successful join
// sets, so the return bar did nothing for a group still being joined.
describe('callConversation', () => {
  const groups = [{ id: 'g1', name: 'Band' }, { id: 'g2', name: 'Climbing' }]
  const dms = [{ id: 'd1', name: 'Ana' }]

  it('finds a group whose call is still connecting, while activeKind is still null', () => {
    // A first join: connect() has set connectingConvId, and activeConvId and
    // activeKind wait for the join to succeed. ChatApp's id is the first of the two.
    const joining = { activeConvId: null, activeKind: null, connectingConvId: 'g2' }
    const id = joining.activeConvId || joining.connectingConvId
    expect(callConversation(id, joining.activeKind, groups, dms)).toEqual({ kind: 'group', group: groups[1] })
  })

  it('finds a group whose join has failed, for as long as the failure is held', () => {
    // giveUp: not connecting, not connected, stage 'failed', the ids kept, activeKind still null.
    const held = f({ connectingConvId: 'g1' })
    expect(failedCallId(held)).toBe('g1')
    expect(callConversation(held.connectingConvId!, null, groups, dms)).toEqual({ kind: 'group', group: groups[0] })
  })

  it('finds a group whose call is up', () => {
    expect(callConversation('g1', 'group', groups, dms)).toEqual({ kind: 'group', group: groups[0] })
    expect(callConversation('g2', 'group', groups, dms)).toEqual({ kind: 'group', group: groups[1] })
  })

  it('finds a DM, whether its call is up or still connecting', () => {
    expect(callConversation('d1', 'dm', groups, dms)).toEqual({ kind: 'dm', dm: dms[0] })
    expect(callConversation('d1', null, groups, dms)).toEqual({ kind: 'dm', dm: dms[0] })
  })

  it('leaves the groups alone once the call is known to be a DM', () => {
    const dm = { id: 'x', name: 'a DM' }
    expect(callConversation('x', 'dm', [{ id: 'x', name: 'a group' }], [dm])).toEqual({ kind: 'dm', dm })
  })

  it('is null for a voice channel’s id, which the caller finds first, and for an id in neither list', () => {
    expect(callConversation('voice-ch', 'channel', groups, dms)).toBeNull()
    expect(callConversation('gone', null, groups, dms)).toBeNull()
  })
})
