package xyz.skycord.android.core

/**
 * The server keeps a sign-in in one httpOnly cookie, syk_rt. The WebView
 * stores it; the background service reads it back out of the Cookie:-style
 * header CookieManager hands over (every cookie for the origin, "a=1; b=2")
 * and uses it to ask for its own short-lived access token.
 */
object RefreshCookie {
    /** Must match REFRESH_COOKIE in server/utils/cookie.ts. */
    const val NAME = "syk_rt"

    /** The value of syk_rt in [cookieHeader], or null when it is absent or empty. */
    fun from(cookieHeader: String?): String? {
        if (cookieHeader == null) return null
        for (part in cookieHeader.split(';')) {
            val pair = part.trim()
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            // The whole name, never a suffix or prefix of another cookie's name. The first match wins, as it does on the server.
            if (pair.substring(0, eq).trim() != NAME) continue
            return pair.substring(eq + 1).trim().ifEmpty { null }
        }
        return null
    }
}
