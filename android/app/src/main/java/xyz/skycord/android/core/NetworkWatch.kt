package xyz.skycord.android.core

/**
 * Whether the phone's default network is a different one than the one the connection was
 * made on, so a socket that looks connected is probably dead and should be made again
 * instead of waiting out its ping timeout. The first network the service sees is not a change
 * (Android reports the current one as soon as the callback is registered); the same one coming
 * back after being lost is. Worker thread only. [net] is whatever identifies a network (equals).
 */
class NetworkWatch {
    private var seen = false
    private var current: Any? = null
    private var lost = false

    /** The default network is [net]: true when it is not the one the connection was made on. */
    fun onAvailable(net: Any): Boolean {
        val changed = seen && (net != current || lost)
        seen = true
        current = net
        lost = false
        return changed
    }

    /** [net] went away. Only the current one counts; an old one leaving after its replacement is up is no news. */
    fun onLost(net: Any) {
        if (net == current) lost = true
    }
}
