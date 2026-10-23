package xyz.skycord.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Whether the phone's default network is a different one than the connection was made on. */
class NetworkWatchTest {
    @Test fun theNetworkTheServiceStartsOnIsNotAChange() {
        assertFalse(NetworkWatch().onAvailable("wifi"))
    }

    @Test fun theSameNetworkAgainIsNotAChange() {
        val w = NetworkWatch()
        w.onAvailable("wifi")
        assertFalse(w.onAvailable("wifi"))
    }

    @Test fun anotherNetworkIsAChange() {
        val w = NetworkWatch()
        w.onAvailable("wifi")
        assertTrue(w.onAvailable("cell"))
    }

    @Test fun theSameNetworkBackAfterBeingLostIsAChange() {
        // A socket that lived through a gap in coverage is probably dead, whichever network it comes back on.
        val w = NetworkWatch()
        w.onAvailable("wifi")
        w.onLost("wifi")
        assertTrue(w.onAvailable("wifi"))
    }

    @Test fun anOldNetworkBeingLostAfterTheNewOneIsUpIsNotAChange() {
        val w = NetworkWatch()
        w.onAvailable("wifi")
        assertTrue(w.onAvailable("cell"))
        w.onLost("wifi") // the old one going away is no news
        assertFalse(w.onAvailable("cell"))
    }

    @Test fun aChangeIsReportedOnce() {
        val w = NetworkWatch()
        w.onAvailable("wifi")
        assertTrue(w.onAvailable("cell"))
        assertFalse(w.onAvailable("cell"))
    }
}
