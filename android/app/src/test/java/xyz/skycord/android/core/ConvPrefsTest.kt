package xyz.skycord.android.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The person's mutes and notification levels, read from GET /users/me/conversations
 * (usersController.ts getConvPrefs) the way the web client's useConvPrefs.ts reads them:
 * a mute that has run out is no mute, and "default" is no level.
 */
class ConvPrefsTest {
    private val now = 1_792_749_600_000L // 2026-10-23T10:00:00Z

    private fun parse(s: String) = ConvPrefs.parse(JSONObject(s))!!

    @Test fun aMuteWithNoEndMutes() {
        val p = parse("""{"prefs":{"x":{"pinned":false,"muted":true,"mutedUntil":null,"level":"default"}}}""")
        assertTrue(p.isMuted("x", now))
        assertFalse(p.isMuted("y", now))
    }

    @Test fun aMuteMutesUntilItsEndAndNotAfter() {
        val p = parse("""{"prefs":{"x":{"muted":true,"mutedUntil":"2026-10-23T10:00:01.000Z"}}}""")
        assertTrue(p.isMuted("x", now))
        assertFalse(p.isMuted("x", now + 1_000)) // the end itself is over, as on the web (<=)
        assertFalse(p.isMuted("x", now + 60_000))
    }

    @Test fun aMuteWithAnEndThatIsNotADateStillMutes() {
        // Errs towards quiet, as the web's `new Date(junk).getTime() <= now` is false for NaN.
        val p = parse("""{"prefs":{"x":{"muted":true,"mutedUntil":"whenever"}}}""")
        assertTrue(p.isMuted("x", now))
    }

    @Test fun mutedMustBeTrueNotJustPresent() {
        val p = parse("""{"prefs":{"a":{"muted":false},"b":{"muted":"true"},"c":{}}}""")
        assertFalse(p.isMuted("a", now))
        assertFalse(p.isMuted("b", now))
        assertFalse(p.isMuted("c", now))
    }

    @Test fun levelsReadAsTheRulesLevels() {
        val p = parse("""{"prefs":{"a":{"level":"all"},"b":{"level":"mentions"},"c":{"level":"nothing"},"d":{"level":"default"},"e":{"level":"loud"},"f":{}}}""")
        assertEquals(Level.ALL, p.levelOf("a"))
        assertEquals(Level.MENTIONS, p.levelOf("b"))
        assertEquals(Level.NOTHING, p.levelOf("c"))
        assertNull(p.levelOf("d"))
        assertNull(p.levelOf("e"))
        assertNull(p.levelOf("f"))
        assertNull(p.levelOf("nowhere"))
    }

    @Test fun noPrefsAtAllIsAnEmptySetNotAFailure() {
        val p = parse("""{"prefs":{}}""")
        assertFalse(p.isMuted("x", now))
        assertNull(p.levelOf("x"))
    }

    @Test fun anAnswerWithoutPrefsIsNotAnAnswer() {
        assertNull(ConvPrefs.parse(JSONObject("""{"message":"nope"}""")))
        assertNull(ConvPrefs.parse(JSONObject("""{"prefs":[]}""")))
    }

    @Test fun anEntryThatIsNotAnObjectIsSkipped() {
        val p = parse("""{"prefs":{"x":true,"y":{"muted":true}}}""")
        assertFalse(p.isMuted("x", now))
        assertTrue(p.isMuted("y", now))
    }

    @Test fun doNotDisturbIsTheChosenStatusUntilItsEnd() {
        assertTrue(ConvPrefs.dnd("dnd", null, now))
        assertTrue(ConvPrefs.dnd("dnd", now + 1, now))
        assertFalse(ConvPrefs.dnd("dnd", now, now))
        assertFalse(ConvPrefs.dnd("online", null, now))
        assertFalse(ConvPrefs.dnd("invisible", null, now))
        assertFalse(ConvPrefs.dnd(null, null, now))
    }
}
