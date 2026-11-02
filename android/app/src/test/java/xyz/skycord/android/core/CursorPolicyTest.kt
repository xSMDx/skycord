package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Where catch-up's place may move to. The rule that matters: never past what the phone has
 * proof of — the last packet that actually arrived on the socket — however long ago that was.
 * What the CPU did since is no part of it: the stream is ordered, so a packet that arrived vouches
 * for everything sent before it.
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
        assertEquals(1_000_000L - margin, CursorPolicy.advance(current = 100L, lastPacketAt = 1_000_000L))
    }

    @Test fun aGapOfSilenceDoesNotLetItJumpOverIt() {
        // The last thing heard was at 1_000_000; now it is hours later and nothing has come since.
        // The caller has no "now" to offer — that is the point — so the cursor can't reach past the packet.
        val moved = CursorPolicy.advance(current = 500_000L, lastPacketAt = 1_000_000L)
        assertEquals(970_000L, moved)
        assertTrue(moved < 1_000_000L)
    }

    @Test fun itNeverMovesBackwards() {
        assertEquals(900_000L, CursorPolicy.advance(current = 900_000L, lastPacketAt = 910_000L))
        assertEquals(900_000L, CursorPolicy.advance(current = 900_000L, lastPacketAt = 0L))
    }

    @Test fun withNothingHeardYetItStaysWhereItIs() {
        assertEquals(123L, CursorPolicy.advance(current = 123L, lastPacketAt = null))
    }

    @Test fun aLastPacketNearerThanTheMarginMovesNothing() {
        assertEquals(500_000L, CursorPolicy.advance(current = 500_000L, lastPacketAt = 510_000L))
    }
}

/** The last packet heard, on the server's clock. */
class LastPacketTest {
    @Test fun nothingIsHeardAtFirst() {
        assertNull(LastPacket().at)
    }

    @Test fun itKeepsTheServerTimeOfTheLatestPacket() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L)
        p.heard(serverNow = 26_000L)
        assertEquals(26_000L, p.at)
    }

    @Test fun clearingForgetsThePacket() {
        val p = LastPacket()
        p.heard(serverNow = 1_000L)
        p.clear()
        assertNull(p.at)
    }
}
