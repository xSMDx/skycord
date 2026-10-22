package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationPolicyTest {
    private val launcher = "https://appassets.androidplatform.net"
    private val server = "https://chat.example.com"

    @Test fun theServersOwnPages_stay() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("https://chat.example.com/channels/1", server, launcher))
    }

    @Test fun theLauncher_staysWhenNoServerIsOpen() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("$launcher/assets/launcher/index.html", null, launcher))
    }

    // A chat link to the launcher must not land the app there: with a server open the launcher's
    // calls are all refused, so it would be a dead end. The app's own loadUrl and history moves
    // never come through here.
    @Test fun theLauncher_isBlockedWhileAServerIsOpen() {
        assertEquals(Nav.BLOCK, NavigationPolicy.decide("$launcher/assets/launcher/index.html", server, launcher))
        assertEquals(Nav.BLOCK, NavigationPolicy.decide("HTTPS://AppAssets.AndroidPlatform.net/assets/launcher/index.html", server, launcher))
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

    @Test fun aWebAddressOriginsCannotRead_stillGoesToTheBrowser() {
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://my_host.example/", server, launcher))
    }

    @Test fun lookalikes_areNotUs() {
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://appassets.androidplatform.net.evil.example/", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("http://appassets.androidplatform.net/", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://chat.example.com.evil.example/", server, launcher))
    }

    @Test fun caseAndDefaultPorts_doNotMatter() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("HTTPS://Chat.Example.com:443/x", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("MAILTO:a@b.c", server, launcher))
        assertEquals(Nav.STAY, NavigationPolicy.decide("HTTPS://AppAssets.AndroidPlatform.net:443/assets/launcher/index.html", null, launcher))
    }
}
