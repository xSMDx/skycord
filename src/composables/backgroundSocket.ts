/**
 * The page's own connection while the Android app is in the background.
 *
 * The app's service keeps its own socket for the notifications and tells the
 * server it is a background one, so it does not count as the person being
 * online. The page's socket is a different matter: left open in the background
 * it makes the person look "idle" to friends all day and keeps a second
 * websocket and a live renderer drawing battery, against the decision that the
 * phone in a pocket is invisible. So the page lets its connection go a little
 * after it is backgrounded, and takes it up again when it is in front.
 *
 * Not while in or joining a call: the call's presence and its mute/deafen
 * state ride the socket. Windows and a browser are not touched.
 *
 * Pure of Vue and of Socket.IO, so the decisions and the timing are tested
 * without either.
 */

/** Long enough for a glance away and back (a notification, the shade) to cost nothing. */
export const BACKGROUND_GRACE_MS = 45_000

/** Whether the page's connection should be let go: Android, backgrounded, no call. */
export const shouldRestSocket = (
  platform: string | undefined, backgrounded: boolean, inCall: boolean,
): boolean => platform === 'android' && backgrounded && !inCall

export interface BackgroundSocket {
  /** Tell it where things stand; call on every change of `backgrounded` or `inCall`. */
  sync(backgrounded: boolean, inCall: boolean): void
  /** True from the moment the connection was let go until it was taken up again. */
  resting(): boolean
  /** Drop a pending grace (the page is going away). Leaves a rest as it is. */
  stop(): void
}

export const createBackgroundSocket = (opts: {
  platform: string | undefined
  /** Let the connection go. */
  rest: () => void
  /** Take it up again, after a rest. */
  wake: () => void
  graceMs?: number
}): BackgroundSocket => {
  const grace = opts.graceMs ?? BACKGROUND_GRACE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let rested = false

  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null } }

  return {
    sync(backgrounded, inCall) {
      if (shouldRestSocket(opts.platform, backgrounded, inCall)) {
        // Already counting down, or already let go: nothing to start.
        if (rested || timer !== null) return
        timer = setTimeout(() => { timer = null; rested = true; opts.rest() }, grace)
        return
      }
      clear()
      if (rested) { rested = false; opts.wake() }
    },
    resting: () => rested,
    stop: clear,
  }
}

/**
 * What the open conversation missed while the connection was away, merged into
 * what is on screen. Nothing replays it on reconnect, so the page asks for the
 * messages after its newest one and slots them in here.
 *
 * Keyed on `dbId` (a message that came live meanwhile is not repeated) and put
 * in order by time rather than just appended: a live message can reach the new
 * socket before the page of missed ones returns, and appending would put the
 * older ones below it. A message still being sent has no `dbId` and the newest
 * time, so it stays at the end. Returns `have` itself when nothing was missed.
 */
export const mergeCaughtUp = <M extends { dbId?: string; timestamp: number }>(have: M[], incoming: M[]): M[] => {
  const known = new Set(have.map(m => m.dbId).filter(Boolean))
  const fresh = incoming.filter(m => !m.dbId || !known.has(m.dbId))
  if (!fresh.length) return have
  const out = [...have]
  for (const m of fresh) {
    let i = out.length
    while (i > 0 && out[i - 1].timestamp > m.timestamp) i--
    out.splice(i, 0, m)
  }
  return out
}
