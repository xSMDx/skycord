package xyz.skycord.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptOnceTest {
    private class Memory : KeyValue {
        val map = mutableMapOf<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    }

    @Test fun firstTimeAsks() {
        assertTrue(PromptOnce.shouldAsk("battery", Memory()))
    }

    @Test fun neverAsksAgainOnceMarked() {
        val store = Memory()
        PromptOnce.markAsked("battery", store)
        assertFalse(PromptOnce.shouldAsk("battery", store))
        // And it stays that way: asking again, or marking again, changes nothing.
        PromptOnce.markAsked("battery", store)
        assertFalse(PromptOnce.shouldAsk("battery", store))
    }

    @Test fun eachQuestionIsItsOwn() {
        val store = Memory()
        PromptOnce.markAsked("post_notifications", store)
        assertFalse(PromptOnce.shouldAsk("post_notifications", store))
        assertTrue(PromptOnce.shouldAsk("battery", store))
        assertTrue(PromptOnce.shouldAsk("full_screen", store))
    }

    @Test fun doesNotCollideWithTheStoresOtherKeys() {
        // The store is the app's one shared store (servers, last): a question named like one of those
        // must not read as already asked, nor overwrite it.
        val store = Memory()
        store.put("last", "https://chat.example.com")
        assertTrue(PromptOnce.shouldAsk("last", store))
        PromptOnce.markAsked("last", store)
        assertFalse(PromptOnce.shouldAsk("last", store))
        assertTrue(store.get("last") == "https://chat.example.com")
    }
}
