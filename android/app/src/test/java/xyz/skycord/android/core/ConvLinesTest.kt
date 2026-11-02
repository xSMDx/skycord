package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What each conversation's notification holds, kept in memory so that a burst of posts
 * (a live flurry, or a catch-up) never reads a list Android has not finished updating.
 */
class ConvLinesTest {
    @Test fun nothingIsHeldUntilSomethingIsAdded() {
        val c = ConvLines<String>()
        assertNull(c.held("dm:a"))
        assertFalse(c.tracked("dm:a"))
    }

    @Test fun linesKeepTheirOrderOldestFirst() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("one"), mentioned = false, nowMs = 0)
        val held = c.append("dm:a", listOf("two", "three"), mentioned = false, nowMs = 1)
        assertEquals(listOf("one", "two", "three"), held.lines)
        assertEquals(listOf("one", "two", "three"), c.held("dm:a")!!.lines)
    }

    @Test fun conversationsAreKeptApart() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("for a"), mentioned = false, nowMs = 0)
        c.append("group:b", listOf("for b"), mentioned = false, nowMs = 0)
        assertEquals(listOf("for a"), c.held("dm:a")!!.lines)
        assertEquals(listOf("for b"), c.held("group:b")!!.lines)
    }

    /** Thirty back-to-back posts: all of them are in, in order, and the oldest five have gone. */
    @Test fun aBurstKeepsTheLastTwentyFive() {
        val c = ConvLines<Int>()
        repeat(30) { c.append("dm:a", listOf(it), mentioned = false, nowMs = it.toLong()) }
        assertEquals((5 until 30).toList(), c.held("dm:a")!!.lines)
    }

    @Test fun oneBigBatchIsCutTheSameWay() {
        val c = ConvLines<Int>(capacity = 3)
        val held = c.append("dm:a", (1..10).toList(), mentioned = false, nowMs = 0)
        assertEquals(listOf(8, 9, 10), held.lines)
    }

    @Test fun onceAMentionIsInItStaysMarked() {
        val c = ConvLines<String>()
        assertFalse(c.append("channel:x", listOf("hi"), mentioned = false, nowMs = 0).mentioned)
        assertTrue(c.append("channel:x", listOf("@you"), mentioned = true, nowMs = 1).mentioned)
        assertTrue(c.append("channel:x", listOf("plain"), mentioned = false, nowMs = 2).mentioned)
    }

    @Test fun clearingForgetsTheLinesAndTheMention() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("old"), mentioned = true, nowMs = 0)
        c.clear("dm:a")
        assertNull(c.held("dm:a"))
        val held = c.append("dm:a", listOf("new"), mentioned = false, nowMs = 1)
        assertEquals(listOf("new"), held.lines)
        assertFalse(held.mentioned)
    }

    @Test fun clearingOneLeavesTheOthers() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("a"), mentioned = false, nowMs = 0)
        c.append("dm:b", listOf("b"), mentioned = false, nowMs = 0)
        c.clear("dm:a")
        assertEquals(listOf("b"), c.held("dm:b")!!.lines)
    }

    @Test fun clearingAllEmptiesEveryConversation() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("a"), mentioned = false, nowMs = 0)
        c.append("dm:b", listOf("b"), mentioned = false, nowMs = 0)
        c.clearAll()
        assertNull(c.held("dm:a"))
        assertNull(c.held("dm:b"))
    }

    // ---- a notification that was showing before this process began ------------------------------

    @Test fun aNotificationFromBeforeTheRestartIsTakenOverOnce() {
        val c = ConvLines<String>()
        assertTrue(c.seed("dm:a", listOf("before 1", "before 2"), mentioned = true, nowMs = 0))
        assertTrue(c.tracked("dm:a"))
        val held = c.append("dm:a", listOf("after"), mentioned = false, nowMs = 1)
        assertEquals(listOf("before 1", "before 2", "after"), held.lines)
        assertTrue(held.mentioned)
    }

    @Test fun aConversationAlreadyHeldIsNotSeededOver() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("mine"), mentioned = false, nowMs = 0)
        assertFalse(c.seed("dm:a", listOf("an older copy"), mentioned = false, nowMs = 1))
        assertEquals(listOf("mine"), c.held("dm:a")!!.lines)
    }

    /** A conversation cleared a moment ago may still show in Android's list; it must not come back. */
    @Test fun aClearedConversationIsNotSeededBack() {
        val c = ConvLines<String>()
        c.append("dm:a", listOf("old"), mentioned = false, nowMs = 0)
        c.clear("dm:a")
        assertTrue(c.tracked("dm:a"))
        assertFalse(c.seed("dm:a", listOf("old"), mentioned = false, nowMs = 1))
        assertNull(c.held("dm:a"))
    }

    @Test fun afterClearingAllNothingIsSeededBack() {
        val c = ConvLines<String>()
        c.clearAll()
        assertFalse(c.seed("dm:never-seen", listOf("old"), mentioned = false, nowMs = 0))
        assertNull(c.held("dm:never-seen"))
    }

    // ---- a notification that went without anyone telling us (a tap, say) -------------------------

    @Test fun whatWasJustPostedCanBeTrustedWithoutAsking() {
        val c = ConvLines<String>(trustMs = 5_000)
        c.append("dm:a", listOf("x"), mentioned = false, nowMs = 1_000)
        assertFalse(c.stale("dm:a", nowMs = 6_000))
    }

    @Test fun whatWasPostedLongAgoShouldBeCheckedAgainstAndroid() {
        val c = ConvLines<String>(trustMs = 5_000)
        c.append("dm:a", listOf("x"), mentioned = false, nowMs = 1_000)
        assertTrue(c.stale("dm:a", nowMs = 6_001))
    }

    @Test fun anotherPostMakesItFreshAgain() {
        val c = ConvLines<String>(trustMs = 5_000)
        c.append("dm:a", listOf("x"), mentioned = false, nowMs = 1_000)
        c.append("dm:a", listOf("y"), mentioned = false, nowMs = 9_000)
        assertFalse(c.stale("dm:a", nowMs = 10_000))
    }

    @Test fun nothingHeldIsNeverStale() {
        val c = ConvLines<String>(trustMs = 5_000)
        assertFalse(c.stale("dm:a", nowMs = 1_000_000))
        c.append("dm:a", listOf("x"), mentioned = false, nowMs = 0)
        c.clear("dm:a")
        assertFalse(c.stale("dm:a", nowMs = 1_000_000))
    }
}
