/**
 * What the app knows about updating, as one value.
 *
 * This used to be spread across a launch flow and a running handler that each
 * registered their own listeners for the same events, and disagreed about who
 * owned `update-downloaded`. The launch flow detached itself after eight
 * seconds and the install was dropped on the floor — silently, for a week,
 * while two releases shipped past a machine still running the old one.
 * One state, built here, is the fix for that class of bug.
 *
 * Pure on purpose: electron-updater's events go in, a value comes out, and
 * the whole machine is testable without Electron.
 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The version being offered or downloaded; '' when there is none. */
  version: string
  /** 0–100. */
  percent: number
  bytesPerSecond: number
  /** Epoch ms of the last completed check, successful or not. 0 = never. */
  lastCheckedAt: number
  /** From the last failure; cleared by the next success. */
  error: string
}

export const initialUpdateState: UpdateState = {
  phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '',
}

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
  | { type: 'none'; at: number }
  | { type: 'error'; message: string; at: number }

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)

export const reduceUpdate = (s: UpdateState, e: UpdateEvent): UpdateState => {
  switch (e.type) {
    case 'check':
      return { ...s, phase: 'checking' }
    case 'available':
      return { ...s, phase: 'available', version: e.version, percent: 0, bytesPerSecond: 0, error: '' }
    case 'progress':
      return { ...s, phase: 'downloading', percent: clamp(e.percent), bytesPerSecond: e.bytesPerSecond, error: '' }
    case 'downloaded':
      return { ...s, phase: 'ready', version: e.version, percent: 100, bytesPerSecond: 0, error: '' }
    case 'none':
      return { ...s, phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: e.at, error: '' }
    case 'error':
      // A downloaded update stays installable. Losing the network after the
      // file is on disk must not take away the Restart button.
      return s.phase === 'ready'
        ? { ...s, lastCheckedAt: e.at, error: e.message }
        : { ...s, phase: 'error', lastCheckedAt: e.at, error: e.message }
  }
}
