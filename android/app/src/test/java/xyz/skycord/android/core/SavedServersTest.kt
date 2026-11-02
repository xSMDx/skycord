package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SavedServersTest {
    private val a = SavedServer("https://a.example.com", "A", null)
    private val b = SavedServer("http://10.0.0.5:3001", "Home", "https://10.0.0.5/icon.png")

    @Test fun readsBackDefensively() {
        val json = """[
            {"origin":"https://A.example.com/","name":" A "},
            {"origin":"https://a.example.com","name":"duplicate"},
            {"origin":"ftp://bad"},
            {"name":"no origin"},
            "not an object",
            {"origin":"http://10.0.0.5:3001","name":"","icon":"javascript:alert(1)"}
        ]"""
        assertEquals(
            listOf(SavedServer("https://a.example.com", "A", null), SavedServer("http://10.0.0.5:3001", "10.0.0.5:3001", null)),
            SavedServers.read(json),
        )
        assertEquals(emptyList<SavedServer>(), SavedServers.read(null))
        assertEquals(emptyList<SavedServer>(), SavedServers.read("{oops"))
    }

    @Test fun roundTrips() {
        assertEquals(listOf(a, b), SavedServers.read(SavedServers.write(listOf(a, b))))
    }

    @Test fun aNewServerGoesLast_aKnownOneKeepsItsPlace() {
        val list = SavedServers.save(listOf(a), b)
        assertEquals(listOf(a, b), list)
        val again = SavedServers.save(list, SavedServer("https://a.example.com", "A renamed", "https://a.example.com/i.png"))
        assertEquals(listOf(SavedServer("https://a.example.com", "A renamed", "https://a.example.com/i.png"), b), again)
    }

    @Test fun keepNameKeepsAMembersOwnName_butReplacesTheDefault() {
        val mine = listOf(SavedServer("https://a.example.com", "My crew", null))
        assertEquals("My crew", SavedServers.save(mine, a, keepName = true)[0].name)
        val default = listOf(SavedServer("https://a.example.com", "a.example.com", null))
        assertEquals("A", SavedServers.save(default, a, keepName = true)[0].name)
    }

    @Test fun removeAndHost() {
        assertEquals(listOf(b), SavedServers.remove(listOf(a, b), a.origin))
        assertEquals("10.0.0.5:3001", SavedServers.hostOf(b.origin))
        assertEquals("a.example.com", SavedServers.hostOf(a.origin))
    }

    @Test fun aJsonNull_isNoValue() {
        val o = org.json.JSONObject("""{"icon":null,"name":"x"}""")
        assertNull(o.stringOrNull("icon"))
        assertNull(o.stringOrNull("missing"))
        assertEquals("x", o.stringOrNull("name"))
    }

    @Test fun anEntryNeedsAnAddress() {
        assertNull(SavedServers.entry("not an address", "x", null))
        assertEquals("x".repeat(64), SavedServers.entry("a.example.com", "x".repeat(100), null)!!.name)
    }
}
