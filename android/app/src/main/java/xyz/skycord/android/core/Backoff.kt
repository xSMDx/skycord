package xyz.skycord.android.core

/**
 * How long the background connection waits before trying again: one second
 * after the first failure, doubling with each one after it, and never more
 * than a minute. The count starts again at 0 once a connection succeeds.
 *
 * A minute is the ceiling because a phone that has just come back into
 * signal should not sit idle for long, and one try a minute costs nothing.
 */
object Backoff {
    const val FIRST_MS = 1_000L
    const val MAX_MS = 60_000L

    /** The wait before try number [attempt] + 1, where 0 is the first failure. */
    fun next(attempt: Int): Long {
        // Past 2^6 the cap has been reached long ago; stopping the shift there keeps it from overflowing.
        val doublings = attempt.coerceIn(0, 6)
        return (FIRST_MS shl doublings).coerceAtMost(MAX_MS)
    }
}
