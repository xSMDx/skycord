package xyz.skycord.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "In front" means a server's own page is on screen and has said hello. Only then does it have
 * the sounds, so only then may the phone stay quiet (and count a message as seen).
 */
class FrontGateTest {
    private val s = "https://skycord.example"
    private val other = "https://other.example"

    private fun gate(onScreen: Boolean = true, shown: String? = s, hello: String? = s) = FrontGate().also {
        it.onScreen(onScreen)
        it.shown(shown)
        if (hello != null) it.hello(hello)
    }

    @Test fun theServersPageOnScreenThatHasSaidHelloIsInFront() {
        assertTrue(gate().inFront(s))
    }

    @Test fun nothingIsInFrontToBeginWith() {
        assertFalse(FrontGate().inFront(s))
    }

    @Test fun aPageStillLoadingHasNotSaidHello() {
        assertFalse(gate(hello = null).inFront(s))
    }

    @Test fun theLauncherIsNotThePage() {
        assertFalse(gate(shown = null, hello = null).inFront(s))
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
        val g = gate(shown = other, hello = other)
        assertFalse(g.inFront(s))
        assertTrue(g.inFront(other))
    }

    @Test fun aHelloFromAPageThatIsNotTheOneShownCountsForNothing() {
        assertFalse(gate(hello = other).inFront(s))
        assertFalse(gate(hello = other).inFront(other))
    }

    /** Opening a server again (retry, switch back) is a new page that has not said hello yet. */
    @Test fun aNewLoadStartsWithoutAHello() {
        val g = gate()
        g.shown(s)
        assertFalse(g.inFront(s))
        g.hello(s)
        assertTrue(g.inFront(s))
    }

    /** The can't-reach screen replaces the page: nothing there to ring or sound. */
    @Test fun thePageGoingAwayEndsIt() {
        val g = gate()
        g.shown(null)
        g.hello(s) // a late hello from a page that is no longer shown
        assertFalse(g.inFront(s))
    }
}
