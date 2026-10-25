import { describe, it, expect } from 'vitest'
import { joinProgress } from '../callStatus'
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
