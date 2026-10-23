package xyz.skycord.android.core

/**
 * Whether Skycord is "in front" for a server: that server's own page is on screen and has said
 * hello over the bridge. Only then does the page have the sounds (and its own ring), so only then
 * may the phone's background connection stay quiet and count a message as seen.
 *
 * Merely having the app open is not enough. The launcher has no chat, the can't-reach screen
 * replaced the page, and a page still loading (or just reloaded) has not subscribed to anything:
 * messages that arrive then would be marked seen and dropped, and catch-up would never bring them
 * back.
 *
 * Three facts, told by the activity and the bridge (all on the main thread), read by the service's
 * worker: the app is on screen; which server's page is showing (null for the launcher or the
 * can't-reach screen); and that page's hello. A new load of the page ([shown]) forgets the old
 * hello; a hello from a page that is not the one shown counts for nothing.
 */
class FrontGate {
    private var onScreen = false
    private var shown: String? = null
    private var helloFrom: String? = null

    /** The app is on screen (the activity started) or not (stopped). */
    @Synchronized
    fun onScreen(on: Boolean) {
        onScreen = on
    }

    /** [origin]'s page is now being shown, a new load that has not said hello; null when no server page is. */
    @Synchronized
    fun shown(origin: String?) {
        shown = origin
        helloFrom = null
    }

    /** The page of [origin] said hello. */
    @Synchronized
    fun hello(origin: String) {
        if (origin == shown) helloFrom = origin
    }

    /** Whether the page of [origin] is on screen and has said hello. */
    @Synchronized
    fun inFront(origin: String): Boolean = onScreen && shown == origin && helloFrom == origin
}
