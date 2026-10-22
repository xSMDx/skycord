package xyz.skycord.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateScheduleTest {
    private val hour = 60 * 60 * 1000L

    @Test fun neverCheckedIsStale() {
        assertTrue(UpdateSchedule.isStale(null, 0))
        assertTrue(UpdateSchedule.isStale(null, 12 * hour))
    }

    @Test fun justCheckedIsNotStale() {
        assertFalse(UpdateSchedule.isStale(1_000, 1_000))
        assertFalse(UpdateSchedule.isStale(1_000, 1_000 + hour))
    }

    @Test fun justUnderSixHoursIsNotStale() {
        assertFalse(UpdateSchedule.isStale(0, 6 * hour - 1))
    }

    @Test fun exactlySixHoursIsStale() {
        assertTrue(UpdateSchedule.isStale(0, 6 * hour))
        assertTrue(UpdateSchedule.isStale(5_000, 5_000 + 6 * hour))
    }

    @Test fun sevenHoursIsStale() {
        assertTrue(UpdateSchedule.isStale(0, 7 * hour))
    }

    @Test fun aClockThatWentBackwardsIsNotStale() {
        assertFalse(UpdateSchedule.isStale(10 * hour, 2 * hour))
        assertFalse(UpdateSchedule.isStale(10 * hour, 10 * hour - 1))
    }

    @Test fun theLimitCanBeChosen() {
        assertTrue(UpdateSchedule.isStale(0, 2 * hour, maxAgeMs = hour))
        assertFalse(UpdateSchedule.isStale(0, hour - 1, maxAgeMs = hour))
    }
}
