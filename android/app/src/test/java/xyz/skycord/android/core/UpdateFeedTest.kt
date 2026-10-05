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

    @Test fun comparesVersions() {
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0"))
        assertTrue(UpdateFeed.isNewer("0.22.0", "0.21.9"))
        assertTrue(UpdateFeed.isNewer("1.0.0", "0.99.99"))
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0-debug"))
        assertFalse(UpdateFeed.isNewer("0.21.0", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("0.20.9", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("garbage", "0.21.0"))
    }
}
