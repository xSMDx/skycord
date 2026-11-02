/**
 * One act over many rows — the library's bulk Delete and Remove from
 * playlist — one row at a time, each awaited before the next.
 *
 * Every call goes through the server's app-wide limit, which a long run can
 * reach. A 429 there is the limit, not the row, so it is read the way the
 * upload queue reads one (judge and retryAfterMs, from uploadScheduler): wait
 * as long as it says, then the same row again. Anything else fails that row
 * alone, in the server's words, and the run moves on.
 *
 * Stopping — Cancel, the room closing — ends a wait at once and clears its
 * timer; the row being waited for was not reached.
 */
import { judge, type Attempt } from './uploadScheduler'

/** What a refused call came back with: the status, its rate headers, a sentence. */
export type Refused = Extract<Attempt<never>, { ok: false }>

export type BulkHooks<R> = {
  /** Stops the run after the row in hand, or at once while waiting out the limit. */
  signal: AbortSignal
  /** A row is done with: null once it went, or why it did not. */
  settled: (row: R, failed: string | null) => void
  /** The limit is being waited out until this moment; null once the next try goes. */
  waiting?: (until: number | null) => void
}

/** Resolves true once `ms` have passed, false at once if stopped first. */
const pause = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return }
    const onStop = (): void => { clearTimeout(t); resolve(false) }
    const t = setTimeout(() => { signal.removeEventListener('abort', onStop); resolve(true) }, Math.max(0, ms))
    signal.addEventListener('abort', onStop, { once: true })
  })

/** Each row in turn. Resolves to how many rows were reached (settled). */
export const runBulk = async <R>(
  rows: readonly R[],
  act: (row: R) => Promise<Refused | null>,
  o: BulkHooks<R>,
): Promise<number> => {
  let at = 0
  rows: for (; at < rows.length; at++) {
    if (o.signal.aborted) break
    const row = rows[at]
    let failed: Refused | null
    for (;;) {
      failed = await act(row)
      if (!failed) break
      const v = judge(failed, Date.now(), { stopped: true })
      if (v.kind !== 'retry') break
      o.waiting?.(v.at)
      const waited = await pause(v.at - Date.now(), o.signal)
      o.waiting?.(null)
      if (!waited) break rows
    }
    o.settled(row, failed ? failed.message || 'Something went wrong.' : null)
  }
  return at
}
