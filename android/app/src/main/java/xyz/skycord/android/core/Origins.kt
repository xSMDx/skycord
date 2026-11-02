package xyz.skycord.android.core

import java.net.URI
import java.net.URISyntaxException

/**
 * Origins as the web means them — scheme://host[:port], lower-case, default
 * ports dropped — the same answer as `new URL(x).origin`, which is what the
 * desktop app and the web client compare. Every origin check in the app goes
 * through here, so the bridge and the navigation rules can never disagree
 * about what "the same server" means.
 * Hosts java.net.URI cannot read (an underscore, an internationalised name) are refused rather than guessed.
 */
object Origins {
    // The same test as normaliseAddress in desktop/src/instanceAddress.ts.
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")

    /** An address as typed ("chat.example.com", "http://10.0.0.5:3001"), or null. No scheme means https. */
    fun normalise(input: String): String? {
        val text = input.trim()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        return of(if (SCHEME.containsMatchIn(text)) text else "https://$text")
    }

    /** The origin of a full URL, or null when it is not an http(s) URL with a host. */
    fun of(url: String): String? {
        // Only scheme://authority decides the origin. The rest of the URL may
        // hold characters a browser leaves unescaped but java.net.URI refuses,
        // so it is cut off before parsing — at the first / ? # or \, which is
        // where the web's URL parser ends the host for http(s).
        val sep = url.indexOf("://")
        if (sep <= 0) return null
        val scheme = url.substring(0, sep).lowercase()
        if (scheme != "https" && scheme != "http") return null
        val rest = url.substring(sep + 3)
        val end = rest.indexOfAny(charArrayOf('/', '?', '#', '\\')).let { if (it < 0) rest.length else it }
        val uri = try { URI("$scheme://${rest.substring(0, end)}") } catch (e: URISyntaxException) { return null }
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val port = uri.port
        if (port > 65535) return null
        val default = if (scheme == "https") 443 else 80
        return if (port == -1 || port == default) "$scheme://$host" else "$scheme://$host:$port"
    }
}
