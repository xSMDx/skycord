package xyz.skycord.android.core

/** When the app looks for an update again after it has been open a while. */
object UpdateSchedule {
    const val SIX_HOURS_MS = 6 * 60 * 60 * 1000L

    /**
     * Whether a check is due. Never checked counts as due. The times come from
     * a monotonic clock; if [now] is somehow earlier than the last check
     * (a clock that went backwards), that is not due either.
     */
    fun isStale(lastCheckStartedAt: Long?, now: Long, maxAgeMs: Long = SIX_HOURS_MS): Boolean =
        lastCheckStartedAt == null || now - lastCheckStartedAt >= maxAgeMs
}
