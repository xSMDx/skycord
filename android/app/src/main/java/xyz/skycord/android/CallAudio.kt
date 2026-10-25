package xyz.skycord.android

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import xyz.skycord.android.core.AudioRoute
import xyz.skycord.android.core.Target
import xyz.skycord.android.core.routeFor
import xyz.skycord.android.core.stateOf

/**
 * Where a call's sound comes out, for a speaker button on the phone call screen: the loudspeaker for
 * each new call, the earpiece when the person turns it off, and a headset whenever one is connected
 * (core/AudioRoutePolicy decides which; this only talks to [AudioManager]).
 *
 * Main thread only, like every bridge call. [changed] is told the route whenever it differs from the
 * last one it was told, which is how a headset plugged in or out mid-call reaches the page.
 *
 * Not offered to pages (app-shim.js has no `audio`), because it cannot move the call. The spike, on the
 * emulator (API 35, WebView 124), found that WebView plays a call's sound as media: its tracks are
 * USAGE_MEDIA and its microphone is a camcorder capture, the mode stays NORMAL, and the communication
 * strategy that [AudioManager.setCommunicationDevice] picks a device for never has a client. A call there
 * already comes out of the loudspeaker, and the earpiece is out of the page's reach. The requests are
 * accepted and nothing in WebView undid them over 30 s, so if a WebView ever plays calls as
 * communication audio, putting `audio` and `onAudioRoute` back in the shim is all that is missing.
 * (The emulator has no earpiece, so a move to one was not seen.)
 */
class CallAudio(context: Context, private val changed: (AudioRoute) -> Unit) {
    private companion object {
        const val TAG = "CallAudio"

        // What counts as a headset for a call. A2DP (music-only Bluetooth) is not one: it cannot carry the
        // microphone, so a call never goes there.
        val HEADSET_TYPES: Set<Int> = buildSet {
            add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
            add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
            add(AudioDeviceInfo.TYPE_USB_HEADSET)
            add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) add(AudioDeviceInfo.TYPE_HEARING_AID)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(AudioDeviceInfo.TYPE_BLE_HEADSET)
        }
    }

    private val audio = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    private var active = false
    private var wantSpeaker = true
    private var told: AudioRoute? = null

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = refresh()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = refresh()
    }

    /**
     * A call began (true) or ended (false). Beginning starts on the speaker and starts watching the
     * devices; ending hands the route back to the system and stops watching. Saying the same thing
     * twice changes nothing, so a page that repeats itself does not undo the person's choice.
     */
    fun setCall(on: Boolean) {
        if (on == active) return
        active = on
        if (on) {
            wantSpeaker = true
            audio.registerAudioDeviceCallback(devices, main)
            refresh()
        } else {
            audio.unregisterAudioDeviceCallback(devices)
            told = null
            release()
        }
    }

    /** The person's choice, loudspeaker (true) or earpiece (false). A headset still wins over it. */
    fun setSpeaker(on: Boolean) {
        wantSpeaker = on
        if (active) refresh()
    }

    /** The route a call has now, or would have if one began. */
    fun state(): AudioRoute {
        val headset = headsetPresent()
        return stateOf(routeFor(wantSpeaker, headset), headset)
    }

    private fun refresh() {
        val headset = headsetPresent()
        val target = routeFor(wantSpeaker, headset)
        route(target)
        val now = stateOf(target, headset)
        if (now != told) {
            told = now
            changed(now)
        }
    }

    private fun headsetPresent(): Boolean {
        val outputs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.availableCommunicationDevices
        else audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).asList()
        return outputs.any { it.type in HEADSET_TYPES }
    }

    // A device that went away between looking and asking, or a phone that refuses, must not take the app
    // down: the route stays as the system had it, and the page is told what [state] says.
    private fun route(target: Target) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // A headset is the system's own pick once nothing overrides it; the two built-in outputs are asked for.
                val type = when (target) {
                    Target.SPEAKER -> AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    Target.EARPIECE -> AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                    Target.HEADSET -> null
                }
                val device = type?.let { t -> audio.availableCommunicationDevices.firstOrNull { it.type == t } }
                if (device == null) audio.clearCommunicationDevice()
                else if (!audio.setCommunicationDevice(device)) Log.w(TAG, "the system refused the route $target")
            } else {
                @Suppress("DEPRECATION") // replaced by setCommunicationDevice from API 31, which is what the branch above uses
                audio.isSpeakerphoneOn = target == Target.SPEAKER
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "could not set the route $target", e)
        }
    }

    private fun release() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audio.clearCommunicationDevice()
            } else {
                @Suppress("DEPRECATION") // as in route()
                audio.isSpeakerphoneOn = false
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "could not hand the route back", e)
        }
    }
}
