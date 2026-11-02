package xyz.skycord.android.core

/**
 * The person's own chosen status as the background service knows it, for one question: Do Not
 * Disturb or not, right now. A timed Do Not Disturb has an end, and the service decides that
 * it has ended on its own: the server does not flip the stored status back when the time comes
 * (the web client does, in a tab, and a phone may be the only client open).
 *
 * Read from `/auth/me` ([load]: `status` and `statusUntil`) and kept current by `presence:self`
 * ([onPresenceSelf]: `status` and `until`, ISO strings or null). The end is on the server's clock,
 * so [dnd] is asked the server's time.
 *
 * Written on the service's thread, read from any: one immutable snapshot, swapped whole.
 */
class SelfStatus {
    private class Snapshot(val status: String?, val untilMs: Long?)

    @Volatile private var now = Snapshot(null, null)

    /** The status `/auth/me` reported, and when it ends ([untilIso], null for no end). Replaces what was known. */
    fun load(status: String?, untilIso: String?) {
        now = Snapshot(status, endOf(untilIso))
    }

    /**
     * A `presence:self`. [status] is what it carried (null if it carried none). [hasUntil] says whether
     * it had an `until` key at all, [until] its value: a status change with no end named has no end (the
     * end that was known belonged to the status before), and an end on its own moves the end of the status known.
     */
    fun onPresenceSelf(status: String?, hasUntil: Boolean, until: String?) {
        val was = now
        now = when {
            status != null -> Snapshot(status, if (hasUntil) endOf(until) else null)
            hasUntil -> Snapshot(was.status, endOf(until))
            else -> was
        }
    }

    /** Whether Do Not Disturb is in effect at [nowMs] (server time): chosen, and its end, if it has one, not reached. */
    fun dnd(nowMs: Long): Boolean = now.let { ConvPrefs.dnd(it.status, it.untilMs, nowMs) }

    companion object {
        /** An end as the server writes it (an ISO instant), in epoch milliseconds; null for none or unreadable. */
        fun endOf(iso: String?): Long? = MessageEvents.epochMs(iso)
    }
}
