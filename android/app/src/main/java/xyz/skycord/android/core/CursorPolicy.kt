package xyz.skycord.android.core

/**
 * Where catch-up's place (the `since` of the next catch-up) may move to.
 *
 * The cursor is the promise "everything before this has been shown". The phone can
 * only keep that promise up to the last packet that actually arrived on the socket:
 * a connection can die silently, so "now" says nothing about what was received.
 * Advancing to now minus a margin, as the first version did, jumped over the whole
 * silent gap and catch-up never fetched it. So the cursor goes only to a margin before
 * the last packet heard (the margin covers a message still in flight when that packet
 * was sent), and never backwards.
 *
 * What the CPU did after that packet is no part of the rule: the stream is ordered, so a
 * packet that arrived vouches for everything the server sent before it, whether the phone
 * slept afterwards or not. (A "the CPU slept" rule only made the cursor lag, and after the
 * process died the next catch-up posted again what had already been shown.)
 */
object CursorPolicy {
    /**
     * Covers a message created just before the last packet and not yet delivered, and the phone's
     * estimate of the server's clock (good to a second or two). Too far back only repeats messages,
     * which the service's seen-set drops; too little would lose them.
     */
    const val MARGIN_MS = 30_000L

    /** With the server's clock unknown, a first run starts this far back on the phone's own. */
    const val FRESH_BACK_MS = 60_000L

    /** The first `since` on a fresh start: the server's clock now, or a minute back if it is unknown. */
    fun fresh(serverNow: Long?, phoneNow: Long): Long = serverNow ?: (phoneNow - FRESH_BACK_MS)

    /**
     * The cursor after moving on from [current] (server clock). [lastPacketAt] is the server-clock
     * time of the last packet heard, null when none has been since the connection was made.
     */
    fun advance(current: Long, lastPacketAt: Long?): Long {
        if (lastPacketAt == null) return current
        return maxOf(current, lastPacketAt - MARGIN_MS)
    }
}

/**
 * The last packet heard on the socket (any event, and the engine's own ping and pong),
 * as a time on the server's clock. Worker thread only.
 */
class LastPacket {
    /** Server-clock time of the last packet, or null when none since the connection began. */
    var at: Long? = null
        private set

    fun heard(serverNow: Long) {
        at = serverNow
    }

    fun clear() {
        at = null
    }
}
