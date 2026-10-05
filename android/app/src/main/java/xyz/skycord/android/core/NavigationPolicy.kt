package xyz.skycord.android.core

enum class Nav { STAY, BROWSER, BLOCK }

/**
 * Where a main-frame navigation goes. The WebView stays on the current
 * server's own pages and the launcher; any other web address opens in the
 * phone's browser; everything else — intent:, file:, javascript:, content:,
 * data: — is refused, because a page should never reach those through us.
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
        if (origin == launcher) return Nav.STAY
        if (server != null && origin == server) return Nav.STAY
        return Nav.BROWSER
    }
}
