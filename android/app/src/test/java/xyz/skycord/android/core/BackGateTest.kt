package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BackGateTest {
    @Test fun thePageUsedIt() {
        val g = BackGate()
        assertEquals(BackAction.DONE, g.answer(g.ask(), used = true))
    }

    @Test fun thePageDidNotUseIt_soTheAppGoesToTheBackground() {
        val g = BackGate()
        assertEquals(BackAction.TO_BACKGROUND, g.answer(g.ask(), used = false))
    }

    @Test fun silence_countsAsUnused_andALateAnswerIsIgnored() {
        val g = BackGate()
        val id = g.ask()
        assertEquals(BackAction.TO_BACKGROUND, g.timeout(id))
        assertNull(g.answer(id, used = true))
    }

    @Test fun anAnswerArrivingFirst_cancelsTheTimeout() {
        val g = BackGate()
        val id = g.ask()
        assertEquals(BackAction.DONE, g.answer(id, used = true))
        assertNull(g.timeout(id))
    }

    @Test fun aNewPress_supersedesTheOld() {
        val g = BackGate()
        val first = g.ask()
        val second = g.ask()
        assertNull(g.answer(first, used = true))
        assertEquals(BackAction.DONE, g.answer(second, used = true))
    }

    @Test fun theTimeoutIs300ms() {
        assertEquals(300L, BackGate().timeoutMs)
    }
}
