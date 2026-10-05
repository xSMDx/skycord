package xyz.skycord.android.core

import org.json.JSONObject

data class Feed(val version: String, val url: String, val sha256: String)

/**
 * latest.json, published with every release. Nothing in it is trusted until
 * it passes here: a plain X.Y.Z version, a download from our own releases
 * repo over https, and a SHA-256 the downloaded file must match.
 */
object UpdateFeed {
    const val FEED_URL = "https://github.com/xSMDx/skycord-android-releases/releases/latest/download/latest.json"
    const val DOWNLOAD_PREFIX = "https://github.com/xSMDx/skycord-android-releases/releases/download/"
    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")
    private val SHA = Regex("^[0-9a-f]{64}$")

    fun parse(text: String): Feed? = try {
        val o = JSONObject(text)
        val version = o.getString("version")
        val url = o.getString("url")
        val sha = o.getString("sha256").lowercase()
        if (VERSION.matches(version) && url.startsWith(DOWNLOAD_PREFIX) && SHA.matches(sha)) Feed(version, url, sha) else null
    } catch (e: Exception) {
        null
    }

    fun isNewer(candidate: String, current: String): Boolean {
        val a = parts(candidate) ?: return false
        val b = parts(current.substringBefore('-')) ?: return true
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    private fun parts(v: String): List<Int>? =
        v.split('.').takeIf { it.size == 3 }?.map { it.toIntOrNull() ?: return null }
}
