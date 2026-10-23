package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The background service signs in with the web client's own refresh cookie,
 * which the WebView hands over as a Cookie:-style header — every cookie for
 * the origin, "name=value; name=value". Only syk_rt is wanted from it.
 */
class RefreshCookieTest {
    @Test fun findsSykRtAmongOtherCookies() {
        assertEquals("abc.def", RefreshCookie.from("a=1; syk_rt=abc.def; b=2"))
    }

    @Test fun theOnlyCookie_orTheFirstOrTheLast() {
        assertEquals("abc.def", RefreshCookie.from("syk_rt=abc.def"))
        assertEquals("abc.def", RefreshCookie.from("syk_rt=abc.def; b=2"))
        assertEquals("abc.def", RefreshCookie.from("a=1; syk_rt=abc.def"))
    }

    @Test fun noneWhenAbsent() {
        assertNull(RefreshCookie.from("a=1; b=2"))
        assertNull(RefreshCookie.from(""))
    }

    @Test fun noneForANullHeader() {
        assertNull(RefreshCookie.from(null))
    }

    @Test fun doesNotMatchACookieWhoseNameMerelyEndsInSykRt() {
        assertNull(RefreshCookie.from("xsyk_rt=1"))
        assertNull(RefreshCookie.from("a=1; xsyk_rt=1; b=2"))
    }

    @Test fun doesNotMatchACookieWhoseNameMerelyStartsWithSykRt() {
        assertNull(RefreshCookie.from("syk_rt2=1"))
    }

    @Test fun doesNotMatchAnotherCookiesValue() {
        assertNull(RefreshCookie.from("a=syk_rt=1"))
    }

    @Test fun anEmptyValueIsNoSignIn() {
        assertNull(RefreshCookie.from("a=1; syk_rt=; b=2"))
    }

    @Test fun aValueKeepsItsOwnEqualsSigns() {
        assertEquals("abc==", RefreshCookie.from("syk_rt=abc=="))
    }

    @Test fun spacingAroundTheSeparatorsIsTolerated() {
        assertEquals("abc.def", RefreshCookie.from("a=1;syk_rt=abc.def ;b=2"))
    }
}
