package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** A message is notified once, however many times it reaches the phone. */
class SeenMessagesTest {
    @Test fun theSameIdTwiceIsADuplicate() {
        val seen = SeenMessages()
        assertTrue(seen.firstTime("m1"))
        assertFalse(seen.firstTime("m1"))
        assertFalse(seen.firstTime("m1"))
    }

    @Test fun anIdSeenLiveAndAgainInCatchUpIsADuplicate() {
        val seen = SeenMessages()
        assertTrue(seen.firstTime("m1")) // live
        assertTrue(seen.firstTime("m2")) // live
        // The socket drops and returns; catch-up lists both again, and a third.
        assertFalse(seen.firstTime("m1"))
        assertFalse(seen.firstTime("m2"))
        assertTrue(seen.firstTime("m3"))
        // And the other way: caught up first, then the live event arrives late.
        assertFalse(seen.firstTime("m3"))
    }

    @Test fun differentIdsAreIndependent() {
        val seen = SeenMessages()
        assertTrue(seen.firstTime("a"))
        assertTrue(seen.firstTime("b"))
        assertFalse(seen.firstTime("a"))
        assertFalse(seen.firstTime("b"))
    }

    @Test fun theOldestIdsFallOutPastCapacity() {
        val seen = SeenMessages(capacity = 3)
        for (id in listOf("a", "b", "c", "d")) assertTrue(seen.firstTime(id)) // d pushes a out
        // The three newest are still known...
        assertFalse(seen.firstTime("b"))
        assertFalse(seen.firstTime("c"))
        assertFalse(seen.firstTime("d"))
        // ...and the oldest is new again.
        assertTrue(seen.firstTime("a"))
    }

    @Test fun anIdMetAgainCountsAsRecentlyUsed() {
        val seen = SeenMessages(capacity = 3)
        for (id in listOf("a", "b", "c")) seen.firstTime(id)
        assertFalse(seen.firstTime("a")) // a is now the most recent, so b is the oldest
        assertTrue(seen.firstTime("d")) // pushes b out, not a
        assertFalse(seen.firstTime("a"))
        assertFalse(seen.firstTime("c"))
        assertTrue(seen.firstTime("b"))
    }

    @Test fun theDefaultCapacityIsTwoThousand() {
        val seen = SeenMessages()
        assertEquals(2000, seen.capacity)
        for (i in 1..2000) assertTrue(seen.firstTime("m$i"))
        assertTrue(seen.firstTime("m2001")) // pushes m1 out
        assertFalse(seen.firstTime("m2000"))
        assertFalse(seen.firstTime("m2"))
        assertTrue(seen.firstTime("m1"))
    }

    @Test fun anIdWithNothingInItIsNeverCalledADuplicate() {
        // No id means no way to tell two messages apart; swallowing the second would lose it.
        val seen = SeenMessages()
        assertTrue(seen.firstTime(""))
        assertTrue(seen.firstTime(""))
        assertTrue(seen.firstTime("  "))
    }

    @Test fun aCapacityOfNothingIsRefused() {
        for (bad in listOf(0, -1)) {
            try {
                SeenMessages(capacity = bad)
                fail("capacity $bad should be refused")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
    }
}
