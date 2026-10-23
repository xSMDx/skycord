package xyz.skycord.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "In front" means a server's own page is on screen and its web client is ready — signed in and
 * listening for the app's word on the background. Only then does it have the sounds, so only then
 * may the phone stay quiet (and count a message as seen). A page that has merely started (or the
 * sign-in screen) is not ready.
 */
class FrontGateTest {
    private val s = "https://skycord.example"
    private val other = "https://other.example"

    private fun gate(onScreen: Boolean = true, shown: String? = s, ready: String? = s) = FrontGate().also {
        it.onScreen(onScreen)
        it.shown(shown)
        if (ready != null) it.ready(ready, true)
    }

    @Test fun theServersPageOnScreenThatIsReadyIsInFront() {
        assertTrue(gate().inFront(s))
    }

    @Test fun nothingIsInFrontToBeginWith() {
        assertFalse(FrontGate().inFront(s))
    }

    /** A page still loading, or on the sign-in screen: shown, but no chat has subscribed. */
    @Test fun aPageThatIsNotReadyIsNotInFront() {
        assertFalse(gate(ready = null).inFront(s))
    }

    @Test fun theLauncherIsNotThePage() {
        assertFalse(gate(shown = null, ready = null).inFront(s))
    }

    @Test fun theLauncherAfterAPageStaysNotInFront() {
        val g = gate()
        g.shown(null)
        assertFalse(g.inFront(s))
    }

    @Test fun anAppThatIsNotOnScreenIsNotInFront() {
        assertFalse(gate(onScreen = false).inFront(s))
    }

    @Test fun comingBackOnScreenWithTheSamePageIsInFrontAgain() {
        val g = gate()
        g.onScreen(false)
        g.onScreen(true)
        assertTrue(g.inFront(s))
    }

    @Test fun anotherServersPageIsInFrontForItselfOnly() {
        val g = gate(shown = other, ready = other)
        assertFalse(g.inFront(s))
        assertTrue(g.inFront(other))
    }

    @Test fun aReadyFromAPageThatIsNotTheOneShownCountsForNothing() {
        assertFalse(gate(ready = other).inFront(s))
        assertFalse(gate(ready = other).inFront(other))
    }

    /** Opening a server again (retry, switch back, a reload) is a new page that is not ready yet. */
    @Test fun aNewLoadStartsNotReady() {
        val g = gate()
        g.shown(s)
        assertFalse(g.inFront(s))
        g.ready(s, true)
        assertTrue(g.inFront(s))
    }

    /** The web client went away (signed out, or the chat unmounted): nobody there to alert or ring. */
    @Test fun theChatGoingAwayEndsIt() {
        val g = gate()
        g.ready(s, false)
        assertFalse(g.inFront(s))
        g.ready(s, true)
        assertTrue(g.inFront(s))
    }

    /** The can't-reach screen replaces the page: nothing there to ring or sound. */
    @Test fun thePageGoingAwayEndsIt() {
        val g = gate()
        g.shown(null)
        g.ready(s, true) // a late ready from a page that is no longer shown
        assertFalse(g.inFront(s))
    }

    /** A same-origin reload or redirect starts a page of its own: the old one's readiness is not inherited. */
    @Test fun aReloadOfTheSameServerForgetsTheOldReadiness() {
        val g = gate()
        assertTrue(g.inFront(s))
        g.shown(s) // onPageStarted for the same origin
        assertFalse(g.inFront(s))
    }

    /** An unready from a page that is not the one shown does not disturb the one that is. */
    @Test fun anUnreadyFromAnotherPageChangesNothing() {
        val g = gate()
        g.ready(other, false)
        assertTrue(g.inFront(s))
    }
}
