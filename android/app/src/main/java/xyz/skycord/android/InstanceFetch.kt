package xyz.skycord.android

import java.net.HttpURLConnection
import java.net.URL

/**
 * GET <origin>/instance, natively. The launcher is an https page and the
 * WebView would refuse its fetch to an http:// server — exactly the home
 * servers people add — so the lookup happens here and only the answer goes
 * back. Only ever this one path on an origin that has already been
 * normalised; never a URL a page chose.
 */
object InstanceFetch {
    data class Answer(val status: Int, val body: String)

    private const val MAX_BYTES = 64 * 1024

    fun get(origin: String): Answer? {
        try {
            val conn = URL("$origin/instance").openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            try {
                val status = conn.responseCode
                // -1 is "not HTTP"; anything outside 200–599 the page's Response() would throw on.
                if (status !in 200..599) return null
                val stream = if (status in 200..399) conn.inputStream else conn.errorStream
                val bytes = stream?.use { it.readNBytesCompat(MAX_BYTES) } ?: ByteArray(0)
                return Answer(status, String(bytes, Charsets.UTF_8))
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            return null
        }
    }

    private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            val n = read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
