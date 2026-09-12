/**
 * What the microphone is actually doing, as opposed to what the UI would like
 * to believe. `micBlocked` used to be a boolean derived from whether the
 * BROWSER HAS getUserMedia — true on any secure origin — so a refused or
 * missing microphone still read as connected and unmuted. The states below are
 * set from what publishing actually did.
 */
export type MicState =
  | 'live'       // publishing
  | 'muted'      // the user muted, or push-to-talk is idle
  | 'denied'     // permission refused
  | 'missing'    // no input device
  | 'busy'       // another application holds the device
  | 'insecure'   // no getUserMedia at all — the page is not on a secure origin
  | 'forbidden'  // the channel's token refuses audio

/**
 * Classify a getUserMedia rejection. The four causes need four different
 * sentences because the recovery differs: denied is a browser prompt, missing
 * is a cable, busy is another app, and insecure is the only one that is the
 * host's problem rather than the member's.
 */
export const micFailureReason = (err: unknown): MicState => {
  const name = (err as { name?: string } | null | undefined)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':        return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError': return 'missing'
    case 'NotReadableError':
    case 'AbortError':           return 'busy'
    // An unrecognised rejection is still a rejection. Reporting 'live' here
    // would reintroduce the exact bug this file exists to fix.
    default:                     return 'denied'
  }
}
