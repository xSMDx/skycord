package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * When the phone rings. Only a fresh DM or group call you are a member of and
 * not in; once per call; stopped by joining, by the call ending or by the
 * timeout; and an unanswered ring is a missed call. An older server sends no
 * startedAt, so there a ring needs an empty-to-occupied change seen live.
 */
class RingGateTest {
    private val now = 1_000_000L
    private val dm = "dm:ana_me"
    private val group = "group:g1"

    private fun gate(): RingGate = RingGate().also { it.onConnected(now - 60_000) }

    // A call:state as the service would hand it over, with the usual case as the default.
    private fun RingGate.state(
        room: String = dm,
        users: List<String> = listOf("ana"),
        startedAt: Long? = now - 5_000,
        isMember: Boolean = true,
        at: Long = now,
        me: String = "me",
    ): RingAction = onCallState(room, users, startedAt, me, isMember, at)

    private fun ring(room: String = dm) = RingAction.Ring(room)
    private fun stop(room: String = dm) = RingAction.Stop(room)
    private fun missed(room: String = dm) = RingAction.Missed(room)

    // ---- who rings, and when -----------------------------------------------

    @Test fun aDmCallStartedFiveSecondsAgoThatYoureNotInRings() {
        assertEquals(ring(), gate().state(startedAt = now - 5_000))
    }

    @Test fun aGroupCallRingsToo() {
        assertEquals(ring(group), gate().state(room = group))
    }

    @Test fun aCallStartedFortySecondsAgoDoesNotRing() {
        assertEquals(RingAction.None, gate().state(startedAt = now - 40_000))
    }

    @Test fun withinThirtySecondsRings_beyondItDoesNot() {
        assertEquals(ring(), gate().state(startedAt = now - 30_000))
        assertEquals(RingAction.None, gate().state(startedAt = now - 30_001))
    }

    @Test fun howFreshACallMustBeCanBeChosen() {
        val g = RingGate(freshMs = 5_000)
        assertEquals(ring("dm:a_me"), g.state(room = "dm:a_me", startedAt = now - 5_000))
        assertEquals(RingAction.None, g.state(room = "dm:b_me", startedAt = now - 5_001))
    }

    @Test fun voiceRoomsNeverRing() {
        val g = gate()
        assertEquals(RingAction.None, g.state(room = "voice:c1", startedAt = now - 1_000))
        assertEquals(RingAction.None, g.state(room = "voice:c1", startedAt = null))
        assertEquals(RingAction.None, g.state(room = "voice:c1", users = emptyList(), startedAt = null))
        assertEquals(RingAction.None, g.onTimeout("voice:c1"))
    }

    @Test fun aRoomYoureNotAMemberOfDoesNotRing() {
        assertEquals(RingAction.None, gate().state(isMember = false))
    }

    @Test fun aCallYoureAlreadyInDoesNotRing() {
        assertEquals(RingAction.None, gate().state(users = listOf("ana", "me")))
        assertEquals(RingAction.None, gate().state(users = listOf("me")))
    }

    @Test fun anEmptyRoomDoesNotRing() {
        assertEquals(RingAction.None, gate().state(users = emptyList(), startedAt = null))
    }

    @Test fun aCallYouJoinedElsewhereDoesNotRingWhenYouLeaveItAgain() {
        val g = gate()
        // Answered on the laptop within a few seconds, left again while it is still young and others remain.
        assertEquals(RingAction.None, g.state(users = listOf("ana", "me")))
        assertEquals(RingAction.None, g.state(users = listOf("ana"), at = now + 10_000))
    }

    // ---- once per call -----------------------------------------------------

    @Test fun theSameCallNeverRingsTwice() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(RingAction.None, g.state())
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob")))
    }

    @Test fun aCallThatRangDoesNotRingAgainOnceItWasMissed() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(missed(), g.onTimeout(dm))
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob")))
    }

    @Test fun aCallThatRangDoesNotRingAgainAfterItEndedAndReturnsWithTheSameStart() {
        // The server keeps a call's start through a short drop-out, so a blip is not a new call.
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null))
        assertEquals(RingAction.None, g.state())
    }

    @Test fun aNewCallInTheSameRoomRingsAgain() {
        val g = gate()
        assertEquals(ring(), g.state(startedAt = now - 5_000))
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null))
        assertEquals(ring(), g.state(startedAt = now + 20_000, at = now + 21_000))
    }

    @Test fun twoRoomsRingIndependently() {
        val g = gate()
        assertEquals(ring(dm), g.state(room = dm))
        assertEquals(ring(group), g.state(room = group))
    }

    @Test fun aCallStartedSlightlyInTheFutureCountsAsFresh() {
        // startedAt is the server's clock; a phone a few seconds behind must still ring.
        assertEquals(ring(), gate().state(startedAt = now + 3_000))
    }

    @Test fun whatItRemembersAboutCallsIsBounded() {
        val g = RingGate(maxRooms = 2)
        for ((room, ago) in listOf("dm:a_me" to 3_000L, "dm:b_me" to 2_000L, "dm:c_me" to 1_000L)) {
            assertEquals(ring(room), g.state(room = room, startedAt = now - ago))
            assertEquals(missed(room), g.onTimeout(room)) // the third call pushes the first out of memory
        }
        assertEquals(RingAction.None, g.state(room = "dm:c_me", startedAt = now - 1_000))
        assertEquals(RingAction.None, g.state(room = "dm:b_me", startedAt = now - 2_000))
        // Past its capacity the oldest call is forgotten, so its replay would ring: it takes more
        // simultaneous calls than there are in a person's life for that to matter.
        assertEquals(ring("dm:a_me"), g.state(room = "dm:a_me", startedAt = now - 3_000))
    }

    // ---- ending a ring -----------------------------------------------------

    @Test fun youJoiningStopsTheRing() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(stop(), g.state(users = listOf("ana", "me")))
        assertEquals(RingAction.None, g.state(users = listOf("ana", "me")))
    }

    @Test fun joiningACallThatWasNotRingingIsNothingToStop() {
        assertEquals(RingAction.None, gate().state(users = listOf("ana", "me")))
    }

    @Test fun theRoomEmptyingBeforeAnswerIsAMissedCall() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null))
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null))
    }

    @Test fun aRoomEmptyingThatWasNotRingingIsNothing() {
        val g = gate()
        assertEquals(RingAction.None, g.state(startedAt = now - 40_000)) // too old to ring
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null))
    }

    @Test fun aTimeoutIsAMissedCall() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(missed(), g.onTimeout(dm))
    }

    @Test fun aTimeoutIsOnlyAMissedCallOnce() {
        val g = gate()
        g.state()
        assertEquals(missed(), g.onTimeout(dm))
        assertEquals(RingAction.None, g.onTimeout(dm))
    }

    @Test fun aTimeoutForARoomThatIsNotRingingIsNothing() {
        val g = gate()
        assertEquals(RingAction.None, g.onTimeout(dm))
        g.state()
        g.state(users = listOf("ana", "me")) // answered
        assertEquals(RingAction.None, g.onTimeout(dm))
    }

    @Test fun aTimeoutAfterTheCallEndedIsNotASecondMissedCall() {
        val g = gate()
        g.state()
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null))
        assertEquals(RingAction.None, g.onTimeout(dm))
    }

    @Test fun theRingKeepsGoingAsOthersJoinAndLeaveTheCall() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob")))
        assertEquals(RingAction.None, g.state(users = listOf("bob")))
        assertEquals(missed(), g.onTimeout(dm))
    }

    // ---- declining ---------------------------------------------------------

    @Test fun aDeclinedCallNeverRingsAgainForThatStartedAt() {
        val g = gate()
        assertEquals(ring(), g.state())
        g.onDeclined(dm)
        assertEquals(RingAction.None, g.state())
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob")))
    }

    @Test fun aDeclinedCallIsNotAMissedCall() {
        val g = gate()
        g.state()
        g.onDeclined(dm)
        assertEquals(RingAction.None, g.onTimeout(dm))
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null))
    }

    @Test fun aNewCallAfterADeclinedOneRings() {
        val g = gate()
        g.state(startedAt = now - 5_000)
        g.onDeclined(dm)
        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = now + 30_000, at = now + 31_000))
    }

    @Test fun decliningOneRoomLeavesAnotherRinging() {
        val g = gate()
        g.state(room = dm)
        g.state(room = group)
        g.onDeclined(dm)
        assertEquals(RingAction.None, g.onTimeout(dm))
        assertEquals(missed(group), g.onTimeout(group))
    }

    @Test fun decliningARoomThatIsNotRingingChangesNothing() {
        val g = gate()
        g.onDeclined(dm)
        assertEquals(ring(), g.state())
    }

    // ---- reconnecting ------------------------------------------------------

    @Test fun aRingInProgressSurvivesAReconnectAndIsNotRungAgain() {
        val g = gate()
        assertEquals(ring(), g.state())
        g.onConnected(now + 1_000)
        assertEquals(RingAction.None, g.state(at = now + 1_500)) // the replay of the same call
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null, at = now + 2_000))
    }

    @Test fun aCallThatRangIsNotRungAgainWhenItsReplayedAfterAReconnect() {
        val g = gate()
        assertEquals(ring(), g.state())
        assertEquals(stop(), g.state(users = listOf("ana", "me")))
        g.onConnected(now + 1_000)
        assertEquals(RingAction.None, g.state(at = now + 1_500))
    }

    @Test fun aFreshCallGoingOnWhenTheServiceConnectsRings() {
        val g = RingGate()
        g.onConnected(now)
        assertEquals(ring(), g.state(startedAt = now - 8_000))
    }

    // ---- an older server: no startedAt -------------------------------------

    @Test fun withoutStartedAt_aRoomOccupiedInTheFirstCallStateAfterConnectingDoesNotRing() {
        // That is a replay of a call already going on, not a call starting.
        val g = gate()
        assertEquals(RingAction.None, g.state(startedAt = null))
        assertEquals(RingAction.None, g.state(startedAt = null, users = listOf("ana", "bob")))
    }

    @Test fun withoutStartedAt_anEmptyToOccupiedChangeSeenAfterConnectingRings() {
        val g = gate()
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null)) // the baseline
        assertEquals(ring(), g.state(startedAt = null))
    }

    @Test fun withoutStartedAt_aChangeFromOccupiedToEmptyToOccupiedRings() {
        val g = gate()
        assertEquals(RingAction.None, g.state(startedAt = null)) // already going on: baseline only
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null))
        assertEquals(ring(), g.state(startedAt = null))
    }

    @Test fun withoutStartedAt_aRoomThatStaysOccupiedRingsOnlyOnce() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = null))
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob"), startedAt = null))
        assertEquals(RingAction.None, g.state(users = listOf("bob"), startedAt = null))
    }

    @Test fun withoutStartedAt_aReconnectStartsTheBaselineOver() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        g.onConnected(now + 1_000)
        // The room is occupied the first time it is heard of since connecting: a replay.
        assertEquals(RingAction.None, g.state(startedAt = null, at = now + 1_500))
    }

    @Test fun withoutStartedAt_theBaselineIsPerRoom() {
        val g = gate()
        g.state(room = dm, users = emptyList(), startedAt = null)
        assertEquals(RingAction.None, g.state(room = group, startedAt = null)) // the group's first word
        assertEquals(ring(dm), g.state(room = dm, startedAt = null))
    }

    @Test fun withoutStartedAt_joiningStopsTheRingAndEmptyingIsMissed() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = null))
        assertEquals(stop(), g.state(users = listOf("ana", "me"), startedAt = null))

        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = null)) // a second call
        assertEquals(missed(), g.state(users = emptyList(), startedAt = null))
    }

    @Test fun withoutStartedAt_aTimeoutIsMissedAndNothingRingsAgainUntilItEmpties() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = null))
        assertEquals(missed(), g.onTimeout(dm))
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob"), startedAt = null))
    }

    @Test fun withoutStartedAt_aDeclinedCallDoesNotRingAgain() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        assertEquals(ring(), g.state(startedAt = null))
        g.onDeclined(dm)
        assertEquals(RingAction.None, g.state(users = listOf("ana", "bob"), startedAt = null))
        assertEquals(RingAction.None, g.state(users = emptyList(), startedAt = null)) // not a missed call
        assertEquals(ring(), g.state(startedAt = null)) // a new call does
    }

    @Test fun withoutStartedAt_notAMemberOrAlreadyInItDoesNotRing() {
        val g = gate()
        g.state(users = emptyList(), startedAt = null)
        assertEquals(RingAction.None, g.state(startedAt = null, isMember = false))
        g.state(users = emptyList(), startedAt = null)
        assertEquals(RingAction.None, g.state(startedAt = null, users = listOf("ana", "me")))
    }

    @Test fun withoutStartedAt_whatItRemembersAboutRoomsIsBounded() {
        val g = RingGate(maxRooms = 2)
        g.state(room = "dm:a_me", users = emptyList(), startedAt = null)
        g.state(room = "dm:b_me", users = emptyList(), startedAt = null)
        g.state(room = "dm:c_me", users = emptyList(), startedAt = null) // forgets a
        // A forgotten room is heard of "for the first time" again, which is the quiet answer.
        assertEquals(RingAction.None, g.state(room = "dm:a_me", startedAt = null))
        assertEquals(ring("dm:c_me"), g.state(room = "dm:c_me", startedAt = null))
    }
}
