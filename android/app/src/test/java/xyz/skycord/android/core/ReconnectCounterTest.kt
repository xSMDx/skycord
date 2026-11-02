package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How many tries in a row have failed, and so how long the next wait is. It starts again
 * only when a session was actually usable — a socket that connects is not that.
 */
class ReconnectCounterTest {
    @Test fun theFirstFailureWaitsOneSecond() {
        assertEquals(1_000L, ReconnectCounter().failed())
    }

    @Test fun eachFailureInARowWaitsTwiceAsLong() {
        val c = ReconnectCounter()
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L), List(8) { c.failed() })
    }

    /** The bug: the socket connects (REST then fails), over and over; the wait must still grow. */
    @Test fun `connect then fail keeps doubling`() {
        val c = ReconnectCounter()
        val waits = ArrayList<Long>()
        repeat(5) {
            c.connected() // the socket is up…
            waits += c.failed() // …but the session is not usable, so it fails
        }
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L), waits)
    }

    @Test fun aUsableSessionStartsTheCountAgain() {
        val c = ReconnectCounter()
        repeat(4) { c.failed() }
        c.markReady()
        assertEquals(1_000L, c.failed())
        assertEquals(2_000L, c.failed())
    }

    @Test fun aDeliberateFreshStartStartsTheCountAgain() {
        val c = ReconnectCounter()
        repeat(4) { c.failed() }
        c.reset()
        assertEquals(1_000L, c.failed())
    }

    @Test fun aHugeRunOfFailuresStaysAtAMinute() {
        val c = ReconnectCounter()
        repeat(10_000) { c.failed() }
        assertEquals(60_000L, c.failed())
    }
}
