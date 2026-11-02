package xyz.skycord.android.core

import org.json.JSONObject

data class Feed(val version: String, val url: String, val sha256: String)

/**
 * latest.json, published with every release. Nothing in it is trusted until
 * it passes here: a plain X.Y.Z version, the exact download address of that
 * version in our own releases repo, and a SHA-256 the downloaded file must match.
 */
object UpdateFeed {
    const val FEED_URL = "https://github.com/xSMDx/skycord-android-releases/releases/latest/download/latest.json"
    const val DOWNLOAD_PREFIX = "https://github.com/xSMDx/skycord-android-releases/releases/download/"
    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")
    private val SHA = Regex("^[0-9a-f]{64}$")

    // The feed is a few hundred bytes. The bracket count is checked before
    // parsing: Android's JSON parser is recursive, and thousands of nested
    // brackets would overflow the stack with an Error that `catch (Exception)`
    // does not stop (the same guard as BridgeProtocol). Counting raw brackets
    // cannot be fooled by quoting tricks, and any nesting of depth d needs at
    // least d opening brackets.
    const val MAX_FEED_BYTES = 64 * 1024
    private const val MAX_OPENS = 256

    fun parse(text: String): Feed? {
        if (text.length > MAX_FEED_BYTES || text.count { it == '[' || it == '{' } > MAX_OPENS) return null
        return parseChecked(text)
    }

    private fun parseChecked(text: String): Feed? = try {
        val o = JSONObject(text)
        val version = o.getString("version")
        val url = o.getString("url")
        val sha = o.getString("sha256").lowercase()
        // Exactly what the release workflow publishes, tied to the version: a prefix alone would let ../ or %2e%2e walk out of our repo.
        if (VERSION.matches(version) && url == downloadUrl(version) && SHA.matches(sha)) Feed(version, url, sha) else null
    } catch (e: Exception) {
        null
    }

    fun downloadUrl(version: String): String = "${DOWNLOAD_PREFIX}android-v$version/skycord-$version.apk"

    fun isNewer(candidate: String, current: String): Boolean {
        val a = parts(candidate) ?: return false
        val b = parts(current.substringBefore('-')) ?: return true
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    private fun parts(v: String): List<Int>? =
        v.split('.').takeIf { it.size == 3 }?.map { it.toIntOrNull() ?: return null }
}
