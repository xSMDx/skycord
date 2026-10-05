package xyz.skycord.android.core

enum class Nav { STAY, BROWSER, BLOCK }

/**
 * Where a main-frame navigation goes. The WebView stays on the current
 * server's own pages and the launcher; any other web address opens in the
 * phone's browser; everything else — intent:, file:, javascript:, content:,
 * data: — is refused, because a page should never reach those through us.
 */
object NavigationPolicy {
    private val HANDOFF = setOf("mailto", "tel")

    fun decide(url: String, server: String?, launcher: String): Nav {
        val origin = Origins.of(url)
            ?: return if (url.substringBefore(':', "").lowercase() in HANDOFF) Nav.BROWSER else Nav.BLOCK
        if (origin == launcher) return Nav.STAY
        if (server != null && origin == server) return Nav.STAY
        return Nav.BROWSER
    }
}
