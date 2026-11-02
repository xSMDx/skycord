package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * One buzz per burst: a conversation's first message alerts, the rest update
 * the notice silently, until it has been quiet for five minutes or the person
 * has dealt with it (rearm). A mention alerts regardless. Catch-up never does.
 */
class BurstGateTest {
    private val minute = 60_000L
    private val t0 = 1_000_000L

    @Test fun theFirstMessageInAConversationIsLoud_theNextSilent() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, mentionsMe = false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 1_000, mentionsMe = false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 2_000, mentionsMe = false))
    }

    @Test fun loudAgainAfterFiveQuietMinutes() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, false))
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 + 300_000, false))
    }

    @Test fun justUnderFiveMinutesIsStillTheSameBurst() {
        val g = BurstGate()
        g.onLive("dm:ana", t0, false)
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 299_999, false))
    }

    @Test fun theQuietClockRunsFromTheLastMessage_notTheFirst() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 4 * minute, false))
        // Eight minutes after the first, but four after the last: still one burst.
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 8 * minute, false))
        // Five quiet minutes after that one: a new burst.
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 + 13 * minute, false))
    }

    @Test fun theQuietTimeCanBeChosen() {
        val g = BurstGate(quietMs = 10_000)
        g.onLive("dm:ana", t0, false)
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 9_999, false))
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 + 9_999 + 10_000, false))
    }

    @Test fun loudAgainAfterRearm() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 1_000, false))
        g.rearm("dm:ana") // the notice was tapped, dismissed or replied to, or the chat was opened
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 + 2_000, false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 3_000, false))
    }

    @Test fun rearmingAConversationThatNeverAlertedIsHarmless() {
        val g = BurstGate()
        g.rearm("dm:nobody")
        assertEquals(Alert.LOUD, g.onLive("dm:nobody", t0, false))
    }

    @Test fun aDirectMentionIsLoudEvenInsideAQuietRun() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("ch:1", t0, false))
        assertEquals(Alert.SILENT, g.onLive("ch:1", t0 + 1_000, false))
        assertEquals(Alert.LOUD, g.onLive("ch:1", t0 + 2_000, mentionsMe = true))
    }

    @Test fun aMentionAsTheFirstMessageIsLoudAndTheRunAfterItStaysQuiet() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("ch:1", t0, mentionsMe = true))
        assertEquals(Alert.SILENT, g.onLive("ch:1", t0 + 1_000, mentionsMe = false))
    }

    @Test fun aMentionIsAMessageToo_soItKeepsTheBurstGoing() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("ch:1", t0, false))
        assertEquals(Alert.LOUD, g.onLive("ch:1", t0 + 4 * minute, mentionsMe = true))
        // Eight minutes after the first message, four after the mention.
        assertEquals(Alert.SILENT, g.onLive("ch:1", t0 + 8 * minute, false))
    }

    @Test fun catchUpIsAlwaysSilent() {
        val g = BurstGate()
        assertEquals(Alert.SILENT, g.onCatchUp("dm:ana"))
        assertEquals(Alert.SILENT, g.onCatchUp("dm:ana"))
        g.rearm("dm:ana")
        assertEquals(Alert.SILENT, g.onCatchUp("dm:ana"))
    }

    @Test fun catchUpNeitherStartsNorDisturbsABurst() {
        val g = BurstGate()
        g.onCatchUp("dm:ana")
        // Nothing alerted yet, so the first live message still does.
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, false))
        g.onCatchUp("dm:ana")
        // And the burst that live message began carries on.
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 1_000, false))
    }

    @Test fun conversationsAreIndependent() {
        val g = BurstGate()
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0, false))
        assertEquals(Alert.LOUD, g.onLive("group:crew", t0 + 1_000, false))
        assertEquals(Alert.SILENT, g.onLive("dm:ana", t0 + 2_000, false))
        assertEquals(Alert.SILENT, g.onLive("group:crew", t0 + 3_000, false))
        g.rearm("dm:ana")
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 + 4_000, false))
        assertEquals(Alert.SILENT, g.onLive("group:crew", t0 + 5_000, false))
    }

    @Test fun aClockThatWentBackwardsAlertsRatherThanStayingSilent() {
        val g = BurstGate()
        g.onLive("dm:ana", t0, false)
        assertEquals(Alert.LOUD, g.onLive("dm:ana", t0 - 10 * minute, false))
    }

    @Test fun whatItRemembersIsBounded_theLeastRecentlyActiveConversationIsForgotten() {
        val g = BurstGate(maxConversations = 2)
        g.onLive("a", t0, false)
        g.onLive("b", t0 + 1, false)
        g.onLive("c", t0 + 2, false) // forgets a
        assertEquals(Alert.SILENT, g.onLive("b", t0 + 3, false))
        assertEquals(Alert.SILENT, g.onLive("c", t0 + 4, false))
        // Forgotten means "first message again": it errs towards a buzz, never towards silence.
        assertEquals(Alert.LOUD, g.onLive("a", t0 + 5, false))
    }
}
