package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CssColorTest {
    @Test fun parsesWhatGetComputedStyleGives() {
        assertEquals(0xFF111214.toInt(), CssColor.parse("#111214"))
        assertEquals(0xFF112233.toInt(), CssColor.parse("#123"))
        assertEquals(0xFF111214.toInt(), CssColor.parse("rgb(17, 18, 20)"))
        assertEquals(0xFF111214.toInt(), CssColor.parse("rgba(17, 18, 20, 1)"))
        assertNull(CssColor.parse("blue"))
        assertNull(CssColor.parse("rgb(1,2)"))
    }

    @Test fun lightOrDark() {
        assertFalse(CssColor.isLight(0xFF111214.toInt()))
        assertTrue(CssColor.isLight(0xFFF2F3F5.toInt()))
    }

    @Test fun aPageCannotBreakItWithStrangeNumbers() {
        assertEquals(0xFFFF0000.toInt(), CssColor.parse("rgb(99999999999, 0, 0)"))
        assertEquals(0xFFFF0000.toInt(), CssColor.parse("rgb(300, 0, 0)"))
        assertNull(CssColor.parse("#-12345"))
        assertNull(CssColor.parse("#+12345"))
        assertNull(CssColor.parse("#12g"))
    }
}
