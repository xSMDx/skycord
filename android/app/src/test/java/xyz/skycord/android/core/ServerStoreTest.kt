package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerStoreTest {
    private class Memory : KeyValue {
        val map = mutableMapOf<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    }

    @Test fun savesAndLists() {
        val store = ServerStore(Memory())
        store.save("chat.example.com", "Chat", null)
        assertEquals(listOf("https://chat.example.com"), store.list().map { it.origin })
        assertEquals("Chat", store.find("https://chat.example.com")?.name)
    }

    @Test fun lastIsOnlyEverASavedServer() {
        val store = ServerStore(Memory())
        store.save("https://chat.example.com", "Chat", null)
        store.setLast("https://chat.example.com")
        assertEquals("https://chat.example.com", store.last())
        store.remove("https://chat.example.com")
        assertNull(store.last())
    }

    @Test fun lastForgetsAnythingThatWasNeverSaved() {
        val kv = Memory()
        kv.put("last", "https://evil.example.com")
        assertNull(ServerStore(kv).last())
    }
}
