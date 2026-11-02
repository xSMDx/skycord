package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateFeedTest {
    private val sha = "a".repeat(64)
    private val url = "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.1/skycord-0.21.1.apk"

    @Test fun readsAGoodFeed() {
        assertEquals(Feed("0.21.1", url, sha), UpdateFeed.parse("""{"version":"0.21.1","url":"$url","sha256":"${sha.uppercase()}","notes":"x"}"""))
    }

    @Test fun refusesAnythingItCannotTrust() {
        for (bad in listOf(
            """{"version":"0.21","url":"$url","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"https://evil.example.com/skycord.apk","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"http://github.com/xSMDx/skycord-android-releases/releases/download/x.apk","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"$url","sha256":"abc"}""",
            "not json",
        )) assertNull(bad, UpdateFeed.parse(bad))
    }

    @Test fun refusesAFeedThatCouldOverflowTheParser() {
        val good = """{"version":"0.21.1","url":"$url","sha256":"$sha"}"""
        // Over 64 KB: rejected before parsing, however well-formed.
        assertNull(UpdateFeed.parse("""{"version":"0.21.1","url":"$url","sha256":"$sha","notes":"${"x".repeat(70 * 1024)}"}"""))
        // 300 nested arrays: Android's recursive parser would overflow the stack.
        assertNull(UpdateFeed.parse("""{"version":"0.21.1","url":"$url","sha256":"$sha","x":${"[".repeat(300)}${"]".repeat(300)}}"""))
        // A normal feed still reads.
        assertEquals(Feed("0.21.1", url, sha), UpdateFeed.parse(good))
    }

    @Test fun comparesVersions() {
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0"))
        assertTrue(UpdateFeed.isNewer("0.22.0", "0.21.9"))
        assertTrue(UpdateFeed.isNewer("1.0.0", "0.99.99"))
        // A two-digit patch compares by number, not by string: 0.20.99 follows 0.20.9.
        assertTrue(UpdateFeed.isNewer("0.20.99", "0.20.9"))
        assertFalse(UpdateFeed.isNewer("0.20.9", "0.20.99"))
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0-debug"))
        assertFalse(UpdateFeed.isNewer("0.21.0", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("0.20.9", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("garbage", "0.21.0"))
    }

    @Test fun onlyTheExactPublishedAddress_forThatVersion() {
        val bad = listOf(
            "${UpdateFeed.DOWNLOAD_PREFIX}../../../../evil/repo/releases/download/x.apk",
            "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.1/%2e%2e/%2e%2e/evil.apk",
            "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.1/skycord-0.21.1.apk ",
            "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.1/skycord-0.21.1.apk?x=1",
            "HTTPS://github.com/xSMDx/skycord-android-releases/releases/download/android-v0.21.1/skycord-0.21.1.apk",
            "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.0/skycord-0.21.0.apk",
        )
        for (u in bad) assertNull(u, UpdateFeed.parse("""{"version":"0.21.1","url":"$u","sha256":"$sha"}"""))
    }
}
