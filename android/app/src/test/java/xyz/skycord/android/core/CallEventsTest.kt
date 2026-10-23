package xyz.skycord.android.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The server's call events as the background connection reads them: `call:state`
 * (chatSocket.ts callStatePayload) and `call:declined` (the `call:decline` handler).
 * Strict about types, like the message events: what is not clearly a string is no id.
 */
class CallEventsTest {
    private fun json(s: String) = JSONObject(s)

    // ---- call:state ------------------------------------------------------------------------------

    @Test fun aStateReadsRoomOccupantsAndStart() {
        val s = CallEvents.state(json("""{"room":"dm:a_b","userIds":["a"],"startedAt":1792749600000,"states":{"a":{}}}"""))
        assertEquals(CallEvents.State("dm:a_b", listOf("a"), 1792749600000L), s)
    }

    @Test fun anOlderServerSendsNoStart() {
        assertEquals(CallEvents.State("group:g1", listOf("a", "b"), null), CallEvents.state(json("""{"room":"group:g1","userIds":["a","b"]}""")))
    }

    @Test fun anEmptyRoomIsStillAState() = assertEquals(CallEvents.State("dm:a_b", emptyList(), null), CallEvents.state(json("""{"room":"dm:a_b","userIds":[]}""")))

    @Test fun aStartThatIsNotAPositiveNumberIsNoStart() {
        for (bad in listOf("\"soon\"", "null", "-5", "0", "true", "{}")) {
            assertNull(bad, CallEvents.state(json("""{"room":"dm:a_b","userIds":["a"],"startedAt":$bad}"""))!!.startedAt)
        }
    }

    @Test fun aStartWrittenAsADecimalStillReads() =
        assertEquals(1792749600000L, CallEvents.state(json("""{"room":"dm:a_b","userIds":["a"],"startedAt":1.7927496E12}"""))!!.startedAt)

    @Test fun aStateWithoutARoomIsDropped() {
        assertNull(CallEvents.state(json("""{"userIds":["a"]}""")))
        assertNull(CallEvents.state(json("""{"room":"","userIds":["a"]}""")))
        assertNull(CallEvents.state(json("""{"room":5,"userIds":["a"]}""")))
    }

    @Test fun aStateWithoutOccupantsAsAListIsDropped() {
        assertNull(CallEvents.state(json("""{"room":"dm:a_b"}""")))
        assertNull(CallEvents.state(json("""{"room":"dm:a_b","userIds":"a"}""")))
    }

    @Test fun anOccupantThatIsNotAnIdDropsTheState() {
        assertNull(CallEvents.state(json("""{"room":"dm:a_b","userIds":["a",7]}""")))
        assertNull(CallEvents.state(json("""{"room":"dm:a_b","userIds":["a",null]}""")))
        assertNull(CallEvents.state(json("""{"room":"dm:a_b","userIds":["a",""]}""")))
    }

    // ---- call:declined -----------------------------------------------------------------------------

    @Test fun aDeclineReadsRoomAndWho() =
        assertEquals(CallEvents.Declined("dm:a_b", "b"), CallEvents.declined(json("""{"room":"dm:a_b","userId":"b","name":"Ben"}""")))

    @Test fun aDeclineWithoutRoomOrWhoIsDropped() {
        assertNull(CallEvents.declined(json("""{"userId":"b"}""")))
        assertNull(CallEvents.declined(json("""{"room":"dm:a_b"}""")))
        assertNull(CallEvents.declined(json("""{"room":"dm:a_b","userId":3}""")))
        assertNull(CallEvents.declined(json("""{"room":"","userId":"b"}""")))
    }
}
