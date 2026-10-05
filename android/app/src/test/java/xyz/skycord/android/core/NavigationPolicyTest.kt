package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationPolicyTest {
    private val launcher = "https://appassets.androidplatform.net"
    private val server = "https://chat.example.com"

    @Test fun theServersOwnPages_stay() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("https://chat.example.com/channels/1", server, launcher))
    }

    @Test fun theLauncher_stays() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("$launcher/assets/launcher/index.html", null, launcher))
    }

    @Test fun otherSites_openInTheBrowser() {
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://example.org/a", server, launcher))
        // Another saved server too: switching happens through the app, not a link.
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://other.example.com/", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("mailto:a@b.c", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("tel:+100", server, launcher))
    }

    @Test fun anythingThatIsNotAWebPage_isBlocked() {
        for (url in listOf("intent://x#Intent;end", "file:///sdcard/a", "javascript:alert(1)", "content://x", "data:text/html,hi")) {
            assertEquals(url, Nav.BLOCK, NavigationPolicy.decide(url, server, launcher))
        }
    }
}
