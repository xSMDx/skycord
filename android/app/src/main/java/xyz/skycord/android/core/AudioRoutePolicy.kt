package xyz.skycord.android.core

/** Where a call's audio comes out. */
enum class Target { SPEAKER, EARPIECE, HEADSET }

/** What the page is told about the route: whether the loudspeaker is on, and whether a headset has taken over. */
data class AudioRoute(val speaker: Boolean, val headset: Boolean)

/**
 * A wired or Bluetooth headset always wins: the person plugged it in to be heard through it, and the
 * speaker button then has nothing to choose. Otherwise it is their choice, the speaker or the earpiece.
 */
fun routeFor(wantSpeaker: Boolean, headset: Boolean): Target = when {
    headset -> Target.HEADSET
    wantSpeaker -> Target.SPEAKER
    else -> Target.EARPIECE
}

/** The page's view of [target]; [headset] is whether one is connected, which the page shows as "Using headset". */
fun stateOf(target: Target, headset: Boolean): AudioRoute = AudioRoute(speaker = target == Target.SPEAKER, headset = headset)
