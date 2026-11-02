package xyz.skycord.android.core

/**
 * Whether Skycord is "in front" for a server: that server's own page is on screen and its web
 * client is ready — signed in, mounted, and listening for the app's word on the background. Only
 * then does the page have the sounds (and its own ring), so only then may the phone's background
 * connection stay quiet and count a message as seen.
 *
 * Merely having the app open is not enough. The launcher has no chat, the can't-reach screen
 * replaced the page, and a page that is still loading, or showing the sign-in screen, has not
 * subscribed to anything: messages that arrive then would be marked seen and dropped, and catch-up
 * would never bring them back. (Not even the page's first hello, at document start, is enough: the
 * web client has not loaded, let alone signed in, by then.)
 *
 * Three facts, told by the activity and the bridge (all on the main thread), read by the service's
 * worker: the app is on screen; which server's page is showing (null for the launcher or the
 * can't-reach screen); and that page's readiness. Every new load of the page ([shown]: a reload,
 * a redirect, opening the server again) forgets the old readiness; a word of readiness from a page
 * that is not the one shown counts for nothing.
 */
class FrontGate {
    private var onScreen = false
    private var shown: String? = null
    private var readyFrom: String? = null

    /** The app is on screen (the activity started) or not (stopped). */
    @Synchronized
    fun onScreen(on: Boolean) {
        onScreen = on
    }

    /** [origin]'s page is now being shown, a new load that is not ready yet; null when no server page is. */
    @Synchronized
    fun shown(origin: String?) {
        shown = origin
        readyFrom = null
    }

    /** The web client of [origin]'s page is ready ([up]) or has gone (signed out, the chat unmounted). */
    @Synchronized
    fun ready(origin: String, up: Boolean) {
        if (origin != shown) return
        readyFrom = if (up) origin else null
    }

    /** Whether the page of [origin] is on screen and its web client is ready. */
    @Synchronized
    fun inFront(origin: String): Boolean = onScreen && shown == origin && readyFrom == origin
}
