package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A catch-up shows each conversation once, with all of its lines in the order they were
 * written, and the conversation that spoke last goes last (so it ends up on top).
 */
class ConvGroupsTest {
    private data class M(val conv: String, val text: String, val at: Long)

    private fun group(vararg items: M) = ConvGroups.byConversation(items.toList(), { it.conv }, { it.at })
        .map { g -> g.map { it.text } }

    @Test fun nothingMakesNoGroups() {
        assertEquals(emptyList<List<String>>(), group())
    }

    @Test fun oneConversationIsOneGroupInOrder() {
        assertEquals(listOf(listOf("a", "b", "c")), group(M("dm:x", "a", 1), M("dm:x", "b", 2), M("dm:x", "c", 3)))
    }

    @Test fun eachConversationIsPostedOnceWithAllItsLines() {
        val out = group(
            M("dm:x", "x1", 1), M("dm:y", "y1", 2), M("dm:x", "x2", 3), M("dm:y", "y2", 4), M("dm:x", "x3", 5),
        )
        assertEquals(listOf(listOf("y1", "y2"), listOf("x1", "x2", "x3")), out)
    }

    @Test fun theConversationThatSpokeLastGoesLast() {
        val out = group(M("dm:a", "a1", 1), M("dm:b", "b1", 2), M("dm:a", "a2", 9))
        assertEquals(listOf(listOf("b1"), listOf("a1", "a2")), out)
    }

    @Test fun conversationsThatTieKeepTheOrderTheyWereFirstMet() {
        val out = group(M("dm:a", "a1", 5), M("dm:b", "b1", 5), M("dm:c", "c1", 5))
        assertEquals(listOf(listOf("a1"), listOf("b1"), listOf("c1")), out)
    }

    /** Five from one conversation, a hundred in all: nothing is dropped on the way. */
    @Test fun aHundredMessagesKeepEveryOne() {
        val items = (1..100).map { M("dm:${it % 20}", "m$it", it.toLong()) }
        val out = ConvGroups.byConversation(items, { it.conv }, { it.at })
        assertEquals(20, out.size)
        assertEquals(100, out.sumOf { it.size })
        out.forEach { g -> assertEquals(g.map { it.at }.sorted(), g.map { it.at }) }
    }
}
