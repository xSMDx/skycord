package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OriginsTest {
    @Test fun anAddressWithoutAScheme_isHttps() {
        assertEquals("https://chat.example.com", Origins.normalise("chat.example.com"))
    }

    @Test fun case_paths_and_defaultPorts_disappear() {
        assertEquals("https://chat.example.com", Origins.normalise("  HTTPS://Chat.Example.com:443/a/b?c=1 "))
        assertEquals("http://box", Origins.normalise("http://box:80/"))
    }

    @Test fun aRealPort_and_plainHttp_stay() {
        assertEquals("http://10.0.0.5:3001", Origins.normalise("http://10.0.0.5:3001"))
        assertEquals("https://chat.example.com:8443", Origins.normalise("https://chat.example.com:8443"))
        assertEquals("http://[::1]:5500", Origins.normalise("http://[::1]:5500/"))
    }

    @Test fun anythingElse_isNotAnAddress() {
        // "host:port" without a scheme reads as scheme "host" — the desktop's
        // normaliseAddress refuses it too, and the two must agree.
        for (bad in listOf("", "   ", "a b", "ftp://x.com", "javascript:alert(1)", "file:///sdcard/x", "https://", "localhost:5500")) {
            assertNull(bad, Origins.normalise(bad))
        }
    }

    @Test fun theOriginOfAFullUrl() {
        assertEquals("https://app.skycord.xyz", Origins.of("https://app.skycord.xyz/channels/1?x=2#y"))
        assertEquals("http://localhost:5500", Origins.of("http://localhost:5500/"))
        assertNull(Origins.of("intent://scan/#Intent;end"))
        assertNull(Origins.of("chat.example.com"))
    }

    @Test fun onlyTheStartOfAUrlMatters_asInABrowser() {
        // Chromium leaves these unescaped after the host; the origin is still the server's.
        assertEquals("https://app.skycord.xyz", Origins.of("https://app.skycord.xyz/search?q=100%"))
        assertEquals("https://app.skycord.xyz", Origins.of("https://app.skycord.xyz/?f={a}|b#x^y"))
        assertEquals("https://chat.example.com", Origins.normalise("chat.example.com/x?y=|"))
        // A backslash ends the host for the web's special schemes, so this is evil.example's page.
        assertEquals("https://evil.example", Origins.of("https://evil.example\\@good.example/"))
    }

    @Test fun aPortIsDefaultOnlyForItsOwnScheme_andMustBeAPort() {
        assertEquals("https://x.example:80", Origins.of("https://x.example:80/"))
        assertEquals("http://x.example:443", Origins.of("http://x.example:443/"))
        assertNull(Origins.of("https://x.example:99999/"))
    }

    @Test fun userInfoIsNotPartOfTheOrigin() {
        assertEquals("https://x.example", Origins.of("https://u:p@x.example/"))
    }
}
