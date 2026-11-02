package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Whether the person is Do Not Disturb right now. A timed one ends on its own at its end time:
 * the server never flips the stored status back, and a phone may be the only client open.
 */
class SelfStatusTest {
    private val t0 = Instant.parse("2026-10-24T10:00:00Z").toEpochMilli()
    private val end = "2026-10-24T11:00:00Z"
    private val endMs = Instant.parse(end).toEpochMilli()

    @Test fun nothingKnownIsNotDnd() {
        assertFalse(SelfStatus().dnd(t0))
    }

    @Test fun anIndefiniteDndNeverEnds() {
        val s = SelfStatus()
        s.load("dnd", null)
        assertTrue(s.dnd(t0))
        assertTrue(s.dnd(t0 + 365L * 24 * 3_600_000))
    }

    @Test fun aTimedDndIsOnUntilItsEndAndOffFromThen() {
        val s = SelfStatus()
        s.load("dnd", end)
        assertTrue(s.dnd(t0))
        assertTrue(s.dnd(endMs - 1))
        assertFalse(s.dnd(endMs))
        assertFalse(s.dnd(endMs + 60_000))
    }

    @Test fun otherStatusesAreNotDnd() {
        val s = SelfStatus()
        for (status in listOf("online", "idle", "invisible")) {
            s.load(status, null)
            assertFalse(status, s.dnd(t0))
        }
    }

    @Test fun anEndThatHasAlreadyPassedMeansNotDnd() {
        val s = SelfStatus()
        s.load("dnd", "2026-10-24T09:00:00Z")
        assertFalse(s.dnd(t0))
    }

    @Test fun loadReplacesWhatWasKnown() {
        val s = SelfStatus()
        s.load("dnd", end)
        s.load("online", null)
        assertFalse(s.dnd(t0))
        s.load("dnd", null)
        assertTrue(s.dnd(endMs + 1))
    }

    @Test fun anEndWithOffsetIsRead() {
        val s = SelfStatus()
        s.load("dnd", "2026-10-24T13:00:00+02:00") // 11:00 UTC
        assertTrue(s.dnd(endMs - 1))
        assertFalse(s.dnd(endMs))
    }

    @Test fun anEndThatCannotBeReadIsNoEnd() {
        val s = SelfStatus()
        s.load("dnd", "soon")
        assertTrue(s.dnd(endMs + 1))
    }

    // ---- presence:self -----------------------------------------------------------------------

    @Test fun presenceSelfSetsATimedDnd() {
        val s = SelfStatus()
        s.load("online", null)
        s.onPresenceSelf("dnd", hasUntil = true, until = end)
        assertTrue(s.dnd(t0))
        assertFalse(s.dnd(endMs))
    }

    @Test fun presenceSelfBackToOnlineEndsIt() {
        val s = SelfStatus()
        s.load("dnd", end)
        s.onPresenceSelf("online", hasUntil = true, until = null)
        assertFalse(s.dnd(t0))
        // ...and the end that went with it is gone: a later indefinite DND is not cut short by it.
        s.onPresenceSelf("dnd", hasUntil = true, until = null)
        assertTrue(s.dnd(endMs + 1))
    }

    /** A status change that says nothing of an end has no end; the old one belonged to the old status. */
    @Test fun aNewStatusWithoutAnEndKeyHasNoEnd() {
        val s = SelfStatus()
        s.load("dnd", "2026-10-24T09:00:00Z")
        s.onPresenceSelf("dnd", hasUntil = false, until = null)
        assertTrue(s.dnd(t0))
    }

    @Test fun anEndAloneMovesTheEndOfTheStatusKnown() {
        val s = SelfStatus()
        s.load("dnd", end)
        s.onPresenceSelf(null, hasUntil = true, until = "2026-10-24T12:00:00Z")
        assertTrue(s.dnd(endMs + 1))
        assertFalse(s.dnd(Instant.parse("2026-10-24T12:00:00Z").toEpochMilli()))
    }

    @Test fun nothingAtAllChangesNothing() {
        val s = SelfStatus()
        s.load("dnd", end)
        s.onPresenceSelf(null, hasUntil = false, until = null)
        assertTrue(s.dnd(t0))
        assertFalse(s.dnd(endMs))
    }

    @Test fun readsTheEndTheServerSent() {
        assertEquals(endMs, SelfStatus.endOf(end))
        assertNull(SelfStatus.endOf(null))
        assertNull(SelfStatus.endOf(""))
    }
}
