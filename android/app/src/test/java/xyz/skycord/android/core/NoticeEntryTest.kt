package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Only the app's own notifications may open a chat or join a call. They enter through a private
 * activity-alias; an intent that reached MainActivity any other way (another app's, with the
 * extras filled in) is a plain launch.
 */
class NoticeEntryTest {
    @Test
    fun theAliasIsHonoured() {
        assertTrue(NoticeEntry.honours("xyz.skycord.android.NoticeEntry"))
    }

    @Test
    fun theLauncherActivityItselfIsNot() {
        // What another app (or the launcher icon) reaches: MainActivity by its own name.
        assertFalse(NoticeEntry.honours("xyz.skycord.android.MainActivity"))
    }

    @Test
    fun noComponentIsNot() {
        // An implicit intent, such as a view or share one, carries no component.
        assertFalse(NoticeEntry.honours(null))
        assertFalse(NoticeEntry.honours(""))
    }

    @Test
    fun onlyTheExactNameCounts() {
        assertFalse(NoticeEntry.honours("xyz.skycord.android.noticeentry"))
        assertFalse(NoticeEntry.honours("xyz.skycord.android.NoticeEntry2"))
        assertFalse(NoticeEntry.honours(" xyz.skycord.android.NoticeEntry"))
        assertFalse(NoticeEntry.honours("evil.NoticeEntry"))
        assertFalse(NoticeEntry.honours(".NoticeEntry"))
    }

    @Test
    fun theManifestNameIsThisOne() {
        // AndroidManifest.xml declares the alias as ".NoticeEntry" in the app's package.
        assertEquals("xyz.skycord.android.NoticeEntry", NoticeEntry.ALIAS)
    }
}
