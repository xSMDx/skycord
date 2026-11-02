package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * After Android kills the process, the notification it left showing is taken over, and the catch-up that
 * follows lists messages that are already in it. A line whose message id the notification already holds
 * must not be added a second time.
 */
class FreshLinesTest {
    private class L(val id: String?, val text: String)

    private fun fresh(held: List<L>, added: List<L>) = freshLines(held, added) { it.id }.map { it.text }

    @Test fun linesNotHeldYetAreAllNew() {
        assertEquals(listOf("b", "c"), fresh(listOf(L("1", "a")), listOf(L("2", "b"), L("3", "c"))))
    }

    @Test fun aLineWhoseIdIsHeldIsLeftOut() {
        assertEquals(listOf("c"), fresh(listOf(L("1", "a"), L("2", "b")), listOf(L("2", "b"), L("3", "c"))))
    }

    @Test fun everyLineHeldMeansNothingNew() {
        assertEquals(emptyList<String>(), fresh(listOf(L("1", "a"), L("2", "b")), listOf(L("1", "a"), L("2", "b"))))
    }

    @Test fun aLineWithNoIdIsAlwaysKept_theNotificationsOwnRepliesHaveNone() {
        assertEquals(listOf("You: ok", "You: ok"), fresh(listOf(L(null, "You: ok")), listOf(L(null, "You: ok"), L(null, "You: ok"))))
    }

    @Test fun theSameIdTwiceInOnePostCountsOnce() {
        assertEquals(listOf("b"), fresh(emptyList(), listOf(L("2", "b"), L("2", "b"))))
    }

    @Test fun nothingHeldKeepsEverything_inOrder() {
        assertEquals(listOf("a", "b"), fresh(emptyList(), listOf(L("1", "a"), L("2", "b"))))
    }
}
