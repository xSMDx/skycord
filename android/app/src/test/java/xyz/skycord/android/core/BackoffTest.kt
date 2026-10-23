package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** How long the background connection waits before its next try: 1 s, doubling, never past a minute. */
class BackoffTest {
    @Test fun theFirstTryWaitsOneSecond() {
        assertEquals(1_000L, Backoff.next(0))
    }

    @Test fun eachFailedTryDoublesTheWait() {
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L), (0..5).map(Backoff::next))
    }

    @Test fun theWaitStopsAtOneMinute() {
        assertEquals(60_000L, Backoff.next(6)) // 64 s, capped
        assertEquals(60_000L, Backoff.next(7))
        assertEquals(60_000L, Backoff.next(30))
    }

    @Test fun aHugeAttemptCountNeitherOverflowsNorGoesNegative() {
        for (attempt in listOf(31, 62, 63, 64, 1_000, Int.MAX_VALUE)) assertEquals(60_000L, Backoff.next(attempt))
    }

    @Test fun aNegativeAttemptCountsAsTheFirst() {
        assertEquals(1_000L, Backoff.next(-1))
        assertEquals(1_000L, Backoff.next(Int.MIN_VALUE))
    }
}
