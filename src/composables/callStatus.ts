/**
 * What to say while a call is still being joined, or has failed to be. One
 * decision for every surface that shows it — the desktop connection strip and
 * the phone call screen's subtitle — so the two cannot word the same moment
 * differently. Pure, so each state can be tested without a call.
 *
 * Only the words and whether they are bad news live here. A surface keeps its
 * own icon and colour: the strip's signal bars are not the phone screen's text.
 * Once the call is up this has nothing to say (null) and the surface shows its
 * own thing — the strip, call quality.
 */
import type { ConnectStage } from './useVoice'

export interface JoinProgress {
  label: string
  /** The red states: no route, or given up. The rest is progress. */
  failing: boolean
}

// Connecting steps, from the real join lifecycle (useVoice.connectStage).
const STAGE_LABEL: Partial<Record<NonNullable<ConnectStage>, string>> = {
  'finding-server': 'Finding server…',
  'connecting':     'Connecting…',
  'authenticating': 'Authenticating…',
  'rtc-connecting': 'RTC connecting…',
}

export const joinProgress = (
  v: { connecting: boolean; connectStage: ConnectStage; connectAttempt: number },
): JoinProgress | null => {
  if (v.connectStage === 'failed') return { label: 'Couldn’t connect', failing: true }
  if (!v.connecting) return null
  // Auto-retry cycle: red "No route" flash, then "Trying again…", repeat.
  if (v.connectStage === 'no-route') return { label: 'No route', failing: true }
  if (v.connectAttempt > 1)          return { label: 'Trying again…', failing: false }
  return { label: STAGE_LABEL[v.connectStage ?? 'connecting'] ?? 'Connecting…', failing: false }
}

/**
 * The conversation whose join has just failed, for as long as the failure is
 * held on screen; null at any other time.
 *
 * useVoice's giveUp clears `connecting` and `connected` and holds
 * `connectStage` at 'failed' until leave() runs at the end of the hold. The
 * ids it keeps say whose join it was: `connectingConvId`, set by the attempt
 * and cleared only by a success or a leave, and `activeConvId` too when the
 * failure was a rejoin of a call that had been up. A surface keyed on
 * "connected or connecting" alone vanishes the instant a join fails, before
 * anyone has read why; this is what keeps it up.
 */
export const failedCallId = (
  v: { connectStage: ConnectStage; connectingConvId: string | null; activeConvId: string | null },
): string | null => (v.connectStage === 'failed' ? (v.connectingConvId ?? v.activeConvId) : null)
