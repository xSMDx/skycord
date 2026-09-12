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

/** Publishing, and only publishing. Everything else is silence of some kind. */
export const micIsLive = (s: MicState): boolean => s === 'live'

/**
 * What `voice.mic` should become once a `setMicrophoneEnabled` call resolves.
 *
 * Both call sites invoke `setMicrophoneEnabled(!voice.localMuted, …)`, so the
 * `muted` argument says which direction just resolved:
 *
 * - `muted === false` means an ENABLE resolved — the browser was just asked
 *   to publish the microphone, and it did. That is direct, fresh evidence
 *   that whatever had refused, lost or handed away the device no longer
 *   applies, so the result is 'live' no matter what `previous` was. This is
 *   what lets a mid-call permission grant clear the notice: deny on join,
 *   grant later, unmute, and the resolved enable proves it now.
 * - `muted === true` means a DISABLE resolved, or the call was a no-op
 *   (post-deafen while still muted resolves the same way). Turning
 *   publishing off succeeds regardless of whether the device is available,
 *   so it is not evidence of anything — a previous failure was never
 *   retested and must survive it, rather than being overwritten with a
 *   generic 'muted'.
 *
 * A real failure is therefore cleared by a fresh publish attempt succeeding,
 * never as a side effect of an unrelated toggle settling.
 */
export const micAfterToggle = (previous: MicState, muted: boolean): MicState => {
  if (!muted) return 'live'
  switch (previous) {
    case 'denied':
    case 'missing':
    case 'busy':
    case 'insecure':
    case 'forbidden': return previous
    default:          return 'muted'
  }
}

/**
 * What to show the person in the call. Written for a member who was invited to
 * somebody else's server: it says what happened and what they can do, and
 * never names HTTPS, certificates or a script to run. The host-facing detail
 * belongs where a host would look, not over a member's microphone.
 */
export const micNotice = (s: MicState): string | null => {
  switch (s) {
    case 'live':
    case 'muted':     return null
    case 'denied':    return 'No microphone access — allow it in your browser to talk'
    case 'missing':   return 'No microphone found — plug one in to talk'
    case 'busy':      return 'Your microphone is in use by another app'
    case 'insecure':  return 'Listening only — this server cannot take your microphone'
    case 'forbidden': return 'Listening only — you cannot speak in this channel'
  }
}
