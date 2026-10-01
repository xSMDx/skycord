/**
 * When to interrupt someone about an update.
 *
 * Once per version, and never mid-call. A prompt that appears over a
 * conversation is one people learn to dismiss without reading, which would
 * undo the point of having it at all.
 */
import type { UpdateState } from './desktopBridge'

export const shouldPrompt = (s: UpdateState, promptedVersion: string, inCall: boolean): boolean =>
  s.phase === 'ready' && !inCall && s.version !== '' && s.version !== promptedVersion
