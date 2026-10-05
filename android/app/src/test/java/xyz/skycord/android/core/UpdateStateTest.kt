package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateStateTest {
    @Test fun followsTheDesktopMachine() {
        var s = UpdateState.INITIAL
        s = reduce(s, UpdateEvent.Check)
        assertEquals(UpdatePhase.CHECKING, s.phase)
        s = reduce(s, UpdateEvent.Available("0.21.1"))
        assertEquals(UpdatePhase.AVAILABLE to "0.21.1", s.phase to s.version)
        s = reduce(s, UpdateEvent.Progress(150.0, 1000.0))
        assertEquals(UpdatePhase.DOWNLOADING to 100.0, s.phase to s.percent)
        s = reduce(s, UpdateEvent.Downloaded("0.21.1"))
        assertEquals(UpdatePhase.READY, s.phase)
    }

    @Test fun anErrorAfterTheDownload_keepsItInstallable() {
        val ready = reduce(UpdateState.INITIAL, UpdateEvent.Downloaded("0.21.1"))
        val after = reduce(ready, UpdateEvent.Error("offline", 5))
        assertEquals(UpdatePhase.READY, after.phase)
        assertEquals("offline", after.error)
        assertEquals(UpdatePhase.ERROR, reduce(UpdateState.INITIAL, UpdateEvent.Error("offline", 5)).phase)
    }

    @Test fun nothingNew_isIdleWithTheTime() {
        val s = reduce(reduce(UpdateState.INITIAL, UpdateEvent.Check), UpdateEvent.None(42))
        assertEquals(UpdatePhase.IDLE to 42L, s.phase to s.lastCheckedAt)
    }

    @Test fun speaksTheWebsShape() {
        val j = UpdateState.INITIAL.toJson()
        assertEquals("idle", j.getString("phase"))
        for (k in listOf("version", "percent", "bytesPerSecond", "lastCheckedAt", "error")) assertTrue(k, j.has(k))
    }

    @Test fun aSpeedThatIsNotANumber_neverBreaksTheJson() {
        val s = reduce(UpdateState.INITIAL, UpdateEvent.Progress(Double.NaN, Double.POSITIVE_INFINITY))
        assertEquals(0.0, s.percent, 0.0)
        assertEquals(0.0, s.bytesPerSecond, 0.0)
        assertEquals("downloading", s.toJson().getString("phase"))
    }
}
