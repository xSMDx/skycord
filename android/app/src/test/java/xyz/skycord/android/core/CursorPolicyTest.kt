package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Where catch-up's place may move to. The rule that matters: never past what the phone has
 * proof of — the last packet that actually arrived on the socket — however long ago that was.
 */
class CursorPolicyTest {
    private val margin = CursorPolicy.MARGIN_MS

    // ---- a fresh start ----

    @Test fun aFreshStartBeginsAtTheServersClockNow() {
        assertEquals(1_000_000L, CursorPolicy.fresh(serverNow = 1_000_000L, phoneNow = 5L))
    }

    @Test fun aFreshStartWithoutTheServersClockBeginsAMinuteBackOnThePhonesOwn() {
        assertEquals(940_000L, CursorPolicy.fresh(serverNow = null, phoneNow = 1_000_000L))
    }

    // ---- moving on ----

    @Test fun theMarginIsThirtySeconds() {
        assertEquals(30_000L, CursorPolicy.MARGIN_MS)
    }

    @Test fun itMovesToAMarginBeforeTheLastPacket() {
        assertEquals(1_000_000L - margin, CursorPolicy.advance(current = 100L, lastPacketAt = 1_000_000L, slept = false))
    }

    @Test fun aGapOfSilenceDoesNotLetItJumpOverIt() {
        // The last thing heard was at 1_000_000; now it is hours later and nothing has come since.
        // The caller has no "now" to offer — that is the point — so the cursor can't reach past the packet.
        val moved = CursorPolicy.advance(current = 500_000L, lastPacketAt = 1_000_000L, slept = false)
        assertEquals(970_000L, moved)
        assertTrue(moved < 1_000_000L)
    }

    @Test fun itNeverMovesBackwards() {
        assertEquals(900_000L, CursorPolicy.advance(current = 900_000L, lastPacketAt = 910_000L, slept = false))
        assertEquals(900_000L, CursorPolicy.advance(current = 900_000L, lastPacketAt = 0L, slept = false))
    }

    @Test fun withNothingHeardYetItStaysWhereItIs() {
        assertEquals(123L, CursorPolicy.advance(current = 123L, lastPacketAt = null, slept = false))
    }

    @Test fun aPhoneThatSleptSinceTheLastPacketStaysWhereItIs() {
        assertEquals(500_000L, CursorPolicy.advance(current = 500_000L, lastPacketAt = 1_000_000L, slept = true))
    }

    @Test fun aLastPacketNearerThanTheMarginMovesNothing() {
        assertEquals(500_000L, CursorPolicy.advance(current = 500_000L, lastPacketAt = 510_000L, slept = false))
    }
}

/** The last packet heard, on the server's clock, and whether the CPU slept since. */
class LastPacketTest {
    @Test fun nothingIsHeardAtFirst() {
        val p = LastPacket()
        assertNull(p.at)
        assertFalse(p.sleptSince(deepSleepNow = 99_999L))
    }

    @Test fun itKeepsTheServerTimeOfTheLatestPacket() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L, deepSleepMs = 0L)
        p.heard(serverNow = 26_000L, deepSleepMs = 0L)
        assertEquals(26_000L, p.at)
    }

    @Test fun aLittleSleepIsNotSleep() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L, deepSleepMs = 10_000L)
        assertFalse(p.sleptSince(deepSleepNow = 10_000L + LastPacket.SLEEP_TOLERANCE_MS))
    }

    @Test fun aLongSleepSinceThePacketIsSleep() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L, deepSleepMs = 10_000L)
        assertTrue(p.sleptSince(deepSleepNow = 10_000L + LastPacket.SLEEP_TOLERANCE_MS + 1))
    }

    @Test fun aNewPacketStartsTheSleepCountAgain() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L, deepSleepMs = 10_000L)
        p.heard(serverNow = 9_000_000L, deepSleepMs = 8_000_000L)
        assertFalse(p.sleptSince(deepSleepNow = 8_000_000L + 1_000L))
    }

    @Test fun clearingForgetsThePacket() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L, deepSleepMs = 0L)
        p.clear()
        assertNull(p.at)
    }
}
