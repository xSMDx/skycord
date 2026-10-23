package xyz.skycord.android.notify

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import xyz.skycord.android.core.RefreshCookie
import xyz.skycord.android.core.ServerClock
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** What asking the server for an access token came to. */
sealed interface AuthResult {
    /**
     * A fresh access token, and how far the phone's clock is from the server's
     * (server minus phone, ms; null when the response carried no usable Date).
     * toString leaves the token out, so a log line can never leak it.
     */
    data class Token(val value: String, val serverOffsetMs: Long?) : AuthResult {
        override fun toString(): String = "Token(serverOffsetMs=$serverOffsetMs)"
    }

    /** No sign-in to use, or the server no longer honours it. The background service stops. */
    data object SignedOut : AuthResult

    /** Could not find out — no network, a slow or failing server. Worth trying again later. */
    data object Unreachable : AuthResult
}

/**
 * The background part of the app signs in with the web client's own sign-in.
 * The person signs in once, in the WebView; the server keeps that in the
 * httpOnly refresh cookie (syk_rt) the WebView stores. This reads that cookie
 * back, trades it at POST /auth/refresh for its own short-lived access token,
 * and writes any cookie the server re-issues back into the WebView's store, so
 * the web client and the native part never disagree about who is signed in.
 *
 * Nothing here ever logs the cookie or the token.
 */
class SessionAuth(@Suppress("unused") context: Context) {
    /** Blocking — call off the main thread. */
    fun accessToken(origin: String): AuthResult {
        val cookies = try {
            CookieManager.getInstance().getCookie(origin)
        } catch (e: Exception) {
            // No WebView to read from says nothing about being signed out; the service must not stop for it.
            Log.w(TAG, "couldn’t read the app’s cookies: ${e.javaClass.simpleName}")
            return AuthResult.Unreachable
        }
        if (RefreshCookie.from(cookies) == null) return AuthResult.SignedOut

        var conn: HttpURLConnection? = null
        try {
            conn = URL("$origin/auth/refresh").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            // A redirect is not the server answering; following it would also carry the cookie to wherever it points.
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.setRequestProperty("Cookie", cookies)
            conn.setRequestProperty("Accept", "application/json")
            // The web client sends no body either; say so rather than leave it to the platform.
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(0)
            conn.outputStream.close()

            return when (val status = conn.responseCode) {
                200 -> {
                    // The re-issued cookie first: the server has already decided on it, whatever the body turns out to be.
                    writeBack(origin, conn)
                    val deadline = System.nanoTime() + TIMEOUT_MS * 1_000_000L
                    val body = conn.inputStream.use { it.readBounded(MAX_BYTES, deadline) }
                    val token = parseToken(String(body, Charsets.UTF_8))
                    if (token == null) {
                        Log.w(TAG, "the refresh answer had no access token")
                        AuthResult.Unreachable
                    } else {
                        AuthResult.Token(token, ServerClock.offsetFrom(conn.getHeaderField("Date"), System.currentTimeMillis()))
                    }
                }
                // The server's answer about this sign-in: missing, revoked, expired, signed out from the devices screen.
                401, 403 -> AuthResult.SignedOut
                // 429 (rate limited), 5xx, a redirect, anything else: the sign-in itself is not in question.
                else -> {
                    Log.w(TAG, "the refresh answered $status")
                    AuthResult.Unreachable
                }
            }
        } catch (e: Exception) {
            // Class name only: some messages quote part of what was being read.
            Log.w(TAG, "couldn’t reach the server to refresh: ${e.javaClass.simpleName}")
            return AuthResult.Unreachable
        } finally {
            conn?.disconnect()
        }
    }

    /** Hands every Set-Cookie line to the WebView's cookie store, then makes it durable. */
    private fun writeBack(origin: String, conn: HttpURLConnection) {
        val lines = conn.headerFields.entries
            .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
            .flatMap { it.value }
        if (lines.isEmpty()) return
        val cookies = CookieManager.getInstance()
        // One header per cookie, never split on commas: an Expires date has one.
        for (line in lines) cookies.setCookie(origin, line)
        cookies.flush()
    }

    private fun parseToken(text: String): String? {
        // Android's JSON parser is recursive; thousands of nested brackets would overflow the stack
        // with an Error that `catch (Exception)` does not stop (the same guard as UpdateFeed).
        if (text.count { it == '[' || it == '{' } > MAX_OPENS) return null
        return try {
            // Only a real JSON string: Android's optString/getString turn null and numbers into "null" and "123".
            (JSONObject(text).opt("accessToken") as? String)?.trim()?.ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }

    /** Reads up to [max] bytes; throws once [deadline] (System.nanoTime) has passed, so a trickling server cannot hold the call open. */
    private fun InputStream.readBounded(max: Int, deadline: Long): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            if (System.nanoTime() - deadline > 0) throw IOException("the answer took too long")
            val n = read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private companion object {
        const val TAG = "SessionAuth"
        const val TIMEOUT_MS = 5000
        const val MAX_BYTES = 64 * 1024
        const val MAX_OPENS = 256
    }
}
