/**
 * The one question the music room asks: leave this channel?
 *
 * Playing something just for you while tuned into a channel takes you out
 * of it — one ear, one thing (see audioFocus.ts). That used to happen
 * silently: click a song in your library and the room's music vanished
 * with no word about why. Now every path that would do it stops here first.
 *
 * State rather than a component, because the question can come from
 * anywhere — a row, the header, the queue drawer, a media key — and is
 * drawn once, by the shell.
 */
import { reactive } from 'vue'

export const leavePrompt = reactive({ open: false, channel: '', what: '' })

let pending: ((yes: boolean) => void) | null = null

export const askToLeave = (channel: string, what: string): Promise<boolean> => {
  // A second question while one is open answers the first one "no": two
  // dialogs stacked for one decision is never what anybody meant.
  pending?.(false)
  leavePrompt.channel = channel
  leavePrompt.what = what
  leavePrompt.open = true
  return new Promise(resolve => { pending = resolve })
}

/** Idempotent: the dialog can close by its button and again as it leaves. */
export const answerLeave = (yes: boolean): void => {
  leavePrompt.open = false
  const r = pending
  pending = null
  r?.(yes)
}
