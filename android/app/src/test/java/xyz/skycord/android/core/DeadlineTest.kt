package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A reply is two network requests in a row (a token, then the send) inside a
 * broadcast that Android gives about ten seconds. One deadline spans both, and
 * each request gets what is left of it, capped at its own usual timeout.
 */
class DeadlineTest {
    private var nowNs = 1_000_000_000L
    private fun deadline(totalMs: Long) = Deadline(totalMs) { nowNs }
    private fun pass(ms: Long) { nowNs += ms * 1_000_000L }

    @Test fun aRequestGetsItsUsualTimeoutWhileThereIsPlentyLeft() {
        assertEquals(5_000, deadline(7_000).timeoutMs(5_000))
    }

    @Test fun aRequestGetsOnlyWhatIsLeft() {
        val d = deadline(7_000)
        pass(4_500)
        assertEquals(2_500, d.timeoutMs(5_000))
    }

    @Test fun theLeftoverShrinksAcrossTwoRequests() {
        val d = deadline(7_000)
        assertEquals(5_000, d.timeoutMs(5_000))
        pass(4_000)
        assertEquals(3_000, d.timeoutMs(5_000))
    }

    @Test fun nothingLeftMeansExpired_andNoTimeoutIsOffered() {
        val d = deadline(7_000)
        pass(7_000)
        assertTrue(d.expired())
        // 0 must never reach HttpURLConnection, where it means "wait forever".
        assertEquals(0, d.timeoutMs(5_000))
        pass(1_000)
        assertTrue(d.expired())
        assertEquals(0, d.timeoutMs(5_000))
    }

    @Test fun aLessThanAMillisecondLeftCountsAsNothing() {
        val d = deadline(7_000)
        nowNs += 6_999_500_000L
        assertTrue(d.expired())
        assertEquals(0, d.timeoutMs(5_000))
    }

    @Test fun notExpiredBeforeTheTimeIsUp() {
        val d = deadline(7_000)
        assertFalse(d.expired())
        pass(6_999)
        assertFalse(d.expired())
        assertEquals(1, d.timeoutMs(5_000))
    }

    // A request waits twice: to connect, then for the answer. Under a deadline the two share the request's time.
    @Test fun connectingAndWaitingTogetherFitInTheRequestsTime() {
        assertEquals(2_500 to 2_500, Deadline.connectAndRead(5_000))
        assertEquals(1_000 to 1_000, Deadline.connectAndRead(2_000))
        assertEquals(1 to 2, Deadline.connectAndRead(3))
    }

    @Test fun neitherPartIsEverZero_whichWouldMeanWaitForever() {
        assertEquals(1 to 1, Deadline.connectAndRead(1))
        assertEquals(1 to 1, Deadline.connectAndRead(2))
    }
}
