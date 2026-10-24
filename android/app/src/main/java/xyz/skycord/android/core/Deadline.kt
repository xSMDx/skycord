package xyz.skycord.android.core

/**
 * One time limit for several network requests in a row. A reply typed into a
 * notification is a token request and then the send, inside a broadcast Android
 * gives about ten seconds; each request alone has its own timeouts, so together
 * they could run past it. Each request takes [timeoutMs], which is what is left
 * of the deadline, capped at that request's usual timeout.
 *
 * [nanoTime] is injectable so a test needs no real waiting.
 */
class Deadline(totalMs: Long, private val nanoTime: () -> Long = System::nanoTime) {
    private val end = nanoTime() + totalMs * 1_000_000L

    /** Whole milliseconds left, never below zero. */
    private fun leftMs(): Long = ((end - nanoTime()) / 1_000_000L).coerceAtLeast(0)

    /** True once less than a millisecond is left; no request should start. */
    fun expired(): Boolean = leftMs() == 0L

    /**
     * A timeout for one request: [capMs] or what is left, whichever is less. Zero means nothing is left;
     * never hand that to HttpURLConnection, where a timeout of zero is "wait forever".
     */
    fun timeoutMs(capMs: Int): Int = minOf(capMs.toLong(), leftMs()).toInt()

    companion object {
        /**
         * How a request's [timeoutMs] is shared between waiting to connect and waiting for the answer
         * (HttpURLConnection's connectTimeout and readTimeout), so both together stay inside it.
         * Neither is ever zero.
         */
        fun connectAndRead(timeoutMs: Int): Pair<Int, Int> {
            val connect = (timeoutMs / 2).coerceAtLeast(1)
            return connect to (timeoutMs - connect).coerceAtLeast(1)
        }
    }
}
