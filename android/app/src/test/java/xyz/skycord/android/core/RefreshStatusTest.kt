package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What POST /auth/refresh's status code means for the background sign-in. The
 * server answers 200 with a token, or 401 (with a clearing cookie) for a
 * missing, revoked or expired sign-in. It never sends 403 from there, so a 403
 * is a proxy or firewall in between and says nothing about the person's
 * sign-in: it must not sign the phone out.
 */
class RefreshStatusTest {
    @Test fun a200IsATokenAndIsWrittenBack() {
        assertEquals(RefreshStatus.Outcome.TOKEN, RefreshStatus.outcomeOf(200))
        assertTrue(RefreshStatus.writesBack(200))
    }

    @Test fun only401SignsOutAndIsWrittenBack() {
        assertEquals(RefreshStatus.Outcome.SIGNED_OUT, RefreshStatus.outcomeOf(401))
        assertTrue(RefreshStatus.writesBack(401))
    }

    @Test fun a403IsAProxyNotAnAnswer_unreachableAndNothingWrittenBack() {
        assertEquals(RefreshStatus.Outcome.UNREACHABLE, RefreshStatus.outcomeOf(403))
        assertFalse(RefreshStatus.writesBack(403))
    }

    @Test fun everythingElseIsUnreachableAndNothingIsWrittenBack() {
        for (status in listOf(204, 301, 302, 400, 404, 408, 429, 500, 502, 503, 504, -1)) {
            assertEquals("status $status", RefreshStatus.Outcome.UNREACHABLE, RefreshStatus.outcomeOf(status))
            assertFalse("status $status", RefreshStatus.writesBack(status))
        }
    }
}
