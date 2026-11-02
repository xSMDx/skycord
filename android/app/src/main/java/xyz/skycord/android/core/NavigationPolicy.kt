package xyz.skycord.android.core

enum class Nav { STAY, BROWSER, BLOCK }

/**
 * Where a main-frame navigation goes. The WebView stays on the current
 * server's own pages, or on the launcher's while no server is open (`server`
 * is null); any other web address opens in the phone's browser; everything
 * else — intent:, file:, javascript:, content:, data: — is refused, because a
 * page should never reach those through us.
 *
 * The launcher is refused while a server is open: a link in a message loads in
 * the same WebView, so anyone could post the launcher's address and strand the
 * app on a launcher whose calls are all dropped. Nothing legitimate needs it —
 * the app's own loadUrl and history moves never come through here.
 * `server` and `launcher` are origins as Origins gives them.
 */
object NavigationPolicy {
    private val HANDOFF = setOf("mailto", "tel")
    private val WEB = setOf("http", "https")

    fun decide(url: String, server: String?, launcher: String): Nav {
        val origin = Origins.of(url) ?: return when (url.substringBefore(':', "").lowercase()) {
            in HANDOFF -> Nav.BROWSER
            // A web address Origins can't read (an underscore in its host, say)
            // is still a web page, and never one of ours: the browser can try it.
            in WEB -> Nav.BROWSER
            else -> Nav.BLOCK
        }
        if (origin == launcher) return if (server == null) Nav.STAY else Nav.BLOCK
        if (server != null && origin == server) return Nav.STAY
        return Nav.BROWSER
    }
}
