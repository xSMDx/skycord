package xyz.skycord.android.core

import java.net.URI

/**
 * Origins as the web means them — scheme://host[:port], lower-case, default
 * ports dropped — the same answer as `new URL(x).origin`, which is what the
 * desktop app and the web client compare. Every origin check in the app goes
 * through here, so the bridge and the navigation rules can never disagree
 * about what "the same server" means.
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
        val uri = try { URI(url) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val default = if (scheme == "https") 443 else 80
        return if (uri.port == -1 || uri.port == default) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }
}
