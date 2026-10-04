/**
 * Who has your ear.
 *
 * There are two ways to hear music in this app and they were independent,
 * so both could run at once: the local preview in the music room, and a
 * music channel coming through the call. Sharing the track you were
 * previewing therefore played it twice — your own copy and the room's, a
 * fraction of a second apart, which sounds like a fault rather than a
 * feature.
 *
 * They are mutually exclusive now, and that rule lives here rather than in
 * either of them. Putting it in one and calling the other would make the
 * two composables import each other; a third module that both depend on
 * has no cycle and, more usefully, states the rule in one place instead of
 * leaving it implied by two call sites.
 *
 * This is not a mixer and should not become one. It answers exactly one
 * question — what are you listening to — and the answer is one thing.
 */

export type Listener = 'preview' | 'channel'

let holder: Listener | null = null
const yielders = new Map<Listener, () => void>()

/**
 * Say how to go quiet when something else takes the ear.
 *
 * Registered once at module load by each side. The callback must be safe to
 * run when that side is already silent, because `take` does not know.
 */
export const onYield = (who: Listener, stop: () => void): void => {
  yielders.set(who, stop)
}

/** Claim the ear. Whoever had it is told to stop first. */
export const takeAudio = (who: Listener): void => {
  if (holder && holder !== who) {
    const stop = yielders.get(holder)
    // Cleared before calling, so a yielder that synchronously triggers the
    // other side cannot bounce the ear back and forth.
    holder = null
    stop?.()
  }
  holder = who
}

/** Give it up. A no-op if something else already took it. */
export const release = (who: Listener): void => {
  if (holder === who) holder = null
}

export const current = (): Listener | null => holder
