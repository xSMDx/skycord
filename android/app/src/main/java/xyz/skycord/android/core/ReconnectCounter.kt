package xyz.skycord.android.core

/**
 * How many tries in a row have failed, and so how long the next wait is ([Backoff]).
 *
 * It starts again only when a session turned out to be *usable* ([markReady]: the socket
 * is up and the account loaded). A socket that merely connects does not count: a server
 * whose socket works but whose REST does not (a 5xx, a proxy that routes one and not the
 * other) would otherwise connect, fail and reconnect every second for ever. Worker thread only.
 */
class ReconnectCounter {
    private var failures = 0

    /** A try failed, or a connection that was no use ended: the wait before the next one, counting this failure. */
    fun failed(): Long {
        val wait = Backoff.next(failures)
        failures = (failures + 1).coerceAtMost(MAX_FAILURES)
        return wait
    }

    /** The socket connected. Deliberately nothing: connecting proves nothing about the session. */
    fun connected() = Unit

    /** The session is usable: the next failure waits the first wait again. */
    fun markReady() {
        failures = 0
    }

    /** A deliberate fresh start (a new connection for a new sign-in, or the network changed). */
    fun reset() {
        failures = 0
    }

    private companion object {
        const val MAX_FAILURES = 30
    }
}
