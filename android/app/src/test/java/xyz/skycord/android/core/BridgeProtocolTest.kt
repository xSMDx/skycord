package xyz.skycord.android.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    @Test fun hello() {
        assertEquals(Incoming.Hello, BridgeProtocol.parse("""{"type":"hello"}"""))
    }

    @Test fun aBackAnswer() {
        assertEquals(Incoming.BackAnswer(7, true), BridgeProtocol.parse("""{"type":"back","id":7,"used":true}"""))
        assertEquals(Incoming.BackAnswer(7, false), BridgeProtocol.parse("""{"type":"back","id":7}"""))
    }

    @Test fun aCall_withAndWithoutAnId() {
        val c = BridgeProtocol.parse("""{"type":"call","id":3,"method":"launcher.open","args":["https://x.y"]}""") as Incoming.Call
        assertEquals(3, c.id)
        assertEquals("launcher.open", c.method)
        assertEquals("https://x.y", c.args.getString(0))
        val fire = BridgeProtocol.parse("""{"type":"call","method":"colors","args":[{}]}""") as Incoming.Call
        assertNull(fire.id)
    }

    @Test fun garbage_isNothing() {
        for (bad in listOf("", "nope", "[]", """{"type":"call"}""", """{"type":"other"}""", """{"type":"call","method":"${"x".repeat(80)}"}""")) {
            assertNull(bad, BridgeProtocol.parse(bad))
        }
    }

    // Parsed back, not compared as text: org.json's key order is not fixed.
    @Test fun repliesErrorsAndEvents() {
        val empty = JSONObject(BridgeProtocol.reply(3, null))
        assertTrue(empty.getString("type") == "reply" && empty.getInt("id") == 3 && empty.has("value") && empty.isNull("value"))
        val r = JSONObject(BridgeProtocol.reply(4, JSONObject().put("a", 1)))
        assertEquals(1, r.getJSONObject("value").getInt("a"))
        val e = JSONObject(BridgeProtocol.error(5, "nope"))
        assertEquals("nope", e.getString("error"))
        val ev = JSONObject(BridgeProtocol.event("back", 9))
        assertTrue(ev.getString("type") == "event" && ev.getString("name") == "back" && ev.getInt("value") == 9)
    }

    @Test fun aMessageNestedTooDeep_orTooLarge_isNothing() {
        assertNull(BridgeProtocol.parse("""{"type":"call","method":"x","args":${"[".repeat(300)}${"]".repeat(300)}}"""))
        assertNull(BridgeProtocol.parse("""{"type":"hello","pad":"${"x".repeat(70_000)}"}"""))
        // Brackets inside strings are text, not nesting.
        val c = BridgeProtocol.parse("""{"type":"call","id":1,"method":"launcher.save","args":[{"origin":"https://x.y","name":"[[[[[[[[[[[[[[[[[[[[{"}]}""") as Incoming.Call
        assertEquals("[[[[[[[[[[[[[[[[[[[[{", c.args.getJSONObject(0).getString("name"))
    }

    @Test fun aNullId_isFireAndForget() {
        val c = BridgeProtocol.parse("""{"type":"call","id":null,"method":"colors","args":[]}""") as Incoming.Call
        assertNull(c.id)
    }

    @Test fun typesAreNotGuessed() {
        for (bad in listOf(
            """{"type":"call","id":"7","method":"x"}""",
            """{"type":"call","id":7.5,"method":"x"}""",
            """{"type":"call","method":123}""",
            """{"type":"call","method":null}""",
            """{"type":"call","method":"x","args":{}}""",
            """{"type":"back","id":"7","used":true}""",
            """{"type":"back"}""",
        )) assertNull(bad, BridgeProtocol.parse(bad))
        assertEquals(Incoming.BackAnswer(7, false), BridgeProtocol.parse("""{"type":"back","id":7,"used":"true"}"""))
    }

    @Test fun aMethodNameHasALimit() {
        assertEquals("m".repeat(64), (BridgeProtocol.parse("""{"type":"call","method":"${"m".repeat(64)}"}""") as Incoming.Call).method)
        assertNull(BridgeProtocol.parse("""{"type":"call","method":"${"m".repeat(65)}"}"""))
    }

    // The page's calls (assets/bridge/app-shim.js): the limit once cut off the longest, so the battery
    // "Allow" in Settings › Notifications was dropped without a sound.
    @Test fun everyMethodTheShimCallsGetsThrough() {
        for (method in listOf(
            "changeInstance", "openServers", "colors", "updates.state", "updates.check", "updates.install", "about",
            "seen", "prefsChanged", "androidNotifications.state", "androidNotifications.setEnabled",
            "androidNotifications.openSystemSettings", "androidNotifications.requestBatteryExemption",
        )) {
            val c = BridgeProtocol.parse("""{"type":"call","method":"$method"}""") as? Incoming.Call
            assertEquals(method, c?.method)
        }
    }

    @Test fun quotingTricks_cannotHideNesting() {
        assertNull(BridgeProtocol.parse("{'\"':" + "[".repeat(60_000)))
        assertNull(BridgeProtocol.parse("""{"type":"hello","a":'"',"b":${"[".repeat(300)}"""))
        assertNull(BridgeProtocol.parse("""{"type":"hello","a":/* " */1,"b":${"[".repeat(300)}"""))
    }

    @Test fun upTo256Brackets_isFine() {
        val ok = """{"type":"call","method":"x","args":[{"name":"${"[".repeat(253)}"}]}"""
        assertEquals("[".repeat(253), (BridgeProtocol.parse(ok) as Incoming.Call).args.getJSONObject(0).getString("name"))
        assertNull(BridgeProtocol.parse("""{"type":"call","method":"x","args":[{"name":"${"[".repeat(254)}"}]}"""))
    }
}
