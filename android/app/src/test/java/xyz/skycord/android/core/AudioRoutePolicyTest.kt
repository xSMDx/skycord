package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Where a call's audio should come out. A headset always wins: someone who plugged one in wants to
 * be heard through it, and the speaker button then has nothing to choose. Otherwise it is the
 * person's choice between the loudspeaker and the earpiece.
 */
class AudioRoutePolicyTest {
    @Test fun headsetWinsOverSpeaker() {
        assertEquals(Target.HEADSET, routeFor(wantSpeaker = true, headset = true))
    }

    @Test fun headsetWinsOverEarpiece() {
        assertEquals(Target.HEADSET, routeFor(wantSpeaker = false, headset = true))
    }

    @Test fun speakerWhenWantedAndNoHeadset() {
        assertEquals(Target.SPEAKER, routeFor(wantSpeaker = true, headset = false))
    }

    @Test fun earpieceWhenNotWanted() {
        assertEquals(Target.EARPIECE, routeFor(wantSpeaker = false, headset = false))
    }

    @Test fun stateReportsHeadsetAndSpeaker() {
        assertEquals(AudioRoute(speaker = true, headset = false), stateOf(Target.SPEAKER, headset = false))
        assertEquals(AudioRoute(speaker = false, headset = true), stateOf(Target.HEADSET, headset = true))
        assertEquals(AudioRoute(speaker = false, headset = false), stateOf(Target.EARPIECE, headset = false))
    }
}
