/**
 * Waiting for a call's join to land.
 *
 * connect() only STARTS a join. attemptConnect carries on by itself after it
 * returns: the token request, the media connection, and the retries behind the
 * red "No route" flash, up to the "Couldn't connect" hold. Anything that needs
 * the joined room, such as turning the camera on for a video call, waits here.
 * Reading `voice.connected` once instead is always too early: straight after
 * connect() it is still false.
 *
 * Keyed on the call. A join of some other call landing meanwhile, or a call
 * that was already up somewhere else, is not this one.
 */
import { watch } from 'vue'
import { voice } from './useVoice'

export interface JoinWait {
  /**
   * true once the join of the call has landed; false once it is over without
   * landing (it gave up, was cancelled, or another call took its place), or
   * once the wait itself is cancelled.
   */
  landed: Promise<boolean>
  /** Stop waiting. `landed` settles false if it has not settled yet, and nothing is left watching. */
  cancel: () => void
}

/** Landed (true), still on its way (null), or over without landing (false). */
const outcome = (convId: string): boolean | null => {
  if (voice.connected && voice.activeConvId === convId) return true
  // A retry keeps `connecting` up through the "No route" flash: the same join, still on its way.
  if (voice.connecting && voice.connectingConvId === convId) return null
  return false
}

/**
 * Wait for the join of `convId` to land. Call it once connect() has resolved,
 * when the attempt is under way.
 *
 * The watcher keeps Vue's default, batched flush and must never be made sync.
 * A successful attempt sets `connected` and clears `connecting` a few lines
 * before it sets `activeConvId`. A sync read in between would see a call that
 * is neither joining nor joined, and settle false on a join that worked.
 */
export const whenJoined = (convId: string): JoinWait => {
  let settle: (landed: boolean) => void = () => {}
  const landed = new Promise<boolean>(resolve => {
    const now = outcome(convId)
    // Already decided: nothing to watch.
    if (now !== null) { resolve(now); return }
    const stop = watch(() => outcome(convId), o => { if (o !== null) settle(o) })
    settle = o => { stop(); settle = () => {}; resolve(o) }
  })
  return { landed, cancel: () => settle(false) }
}
