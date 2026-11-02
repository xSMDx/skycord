package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Calls carry startedAt on the server's clock and the phone rings only for a
 * call that started within 30 s, so the phone needs to know how far its own
 * clock is from the server's. The server's Date header is the only clock the
 * refresh response carries.
 */
class ServerClockTest {
    // The RFC's own example instant: Tue, 15 Nov 1994 08:12:31 GMT.
    private val rfcExample = "Tue, 15 Nov 1994 08:12:31 GMT"
    private val rfcExampleMs = 784_887_151_000L

    @Test fun aDateHeaderGivesTheOffsetFromTheLocalClock() {
        // The phone is 5 s behind the server: server minus local is positive.
        assertEquals(5_000L, ServerClock.offsetFrom(rfcExample, rfcExampleMs - 5_000))
        // And 90 s ahead of it: negative.
        assertEquals(-90_000L, ServerClock.offsetFrom(rfcExample, rfcExampleMs + 90_000))
        // In step: zero, not null.
        assertEquals(0L, ServerClock.offsetFrom(rfcExample, rfcExampleMs))
    }

    @Test fun aSingleDigitDayIsStillADate() {
        assertEquals(0L, ServerClock.offsetFrom("Sun, 6 Nov 1994 08:49:37 GMT", 784_111_777_000L))
    }

    @Test fun noneForAMissingHeader() {
        assertNull(ServerClock.offsetFrom(null, 1_000L))
    }

    @Test fun noneForABlankHeader() {
        assertNull(ServerClock.offsetFrom("", 1_000L))
        assertNull(ServerClock.offsetFrom("   ", 1_000L))
    }

    @Test fun noneForGarbage() {
        assertNull(ServerClock.offsetFrom("yesterday-ish", 1_000L))
        assertNull(ServerClock.offsetFrom("Tue, 32 Nov 1994 08:12:31 GMT", 1_000L))
        assertNull(ServerClock.offsetFrom("1994-11-15T08:12:31Z", 1_000L))
    }

    @Test fun surroundingSpacesAreIgnored() {
        assertEquals(0L, ServerClock.offsetFrom("  $rfcExample ", rfcExampleMs))
    }
}
