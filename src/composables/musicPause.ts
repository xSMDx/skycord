/**
 * Whether a call's song is held, and whether it can be, read from a channel
 * as the server describes it.
 *
 * Apart from useMusic, which re-exports both, so the pure rules that only
 * read a channel (musicCommands, phoneCallRules) can ask without loading the
 * socket that useMusic brings with it.
 */
import type { MusicChannelView } from './useMusic'

/**
 * Whether a channel's song is held. Missing means playing — an older server
 * never sends `paused` — and a channel with no song is not paused, whatever
 * the field says, so nothing ever reads "Paused" over "Nothing playing".
 */
export const isPaused = (c: MusicChannelView | null | undefined): boolean =>
  !!c?.now && c.paused === true

/**
 * Whether Pause is offered for a channel: the server says its music service
 * can do it, and there is a song to do it to. An older server or service
 * sends no `pausable`, and then no surface offers Pause.
 */
export const canPause = (c: MusicChannelView | null | undefined): boolean =>
  !!c?.now && c.pausable === true

/**
 * Whether the one Pause/Resume control is offered: Pause as canPause says,
 * and Resume whenever the song is held. `pausable` can drop while a song is
 * paused — the music service restarted, or was swapped for an older one —
 * and a held song with no way to resume it would be stuck for everyone.
 */
export const canPauseOrResume = (c: MusicChannelView | null | undefined): boolean =>
  isPaused(c) || canPause(c)
