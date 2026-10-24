package xyz.skycord.android.notify

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import xyz.skycord.android.core.Deadline
import xyz.skycord.android.core.RefreshCookie
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** What a GET to the server came to. */
internal sealed interface ApiResult {
    data class Ok(val body: JSONObject) : ApiResult

    /** The server answered, but not with 2xx (a 401 only after a fresh token was refused too). */
    data class Status(val code: Int) : ApiResult

    /** No answer worth reading: no network, a timeout, a body that is not JSON. Worth trying again later. */
    data object Unreachable : ApiResult

    /** The sign-in is over. The service stops. */
    data object SignedOut : ApiResult
}

/**
 * One server, as the background service talks to it: its REST routes, with the
 * person's access token, and the token itself, which the socket's handshake
 * uses too.
 *
 * The token is kept and reused. `/auth/refresh` is rate-limited (60 per 15
 * minutes, per address), so a new one is asked for only when the server turns
 * the old one down — a 401 here, or a refused handshake in [LiveConnection] —
 * and never once per reconnect for the sake of it.
 *
 * Only ever built for a server the person saved (the service checks), so the
 * token goes nowhere else. Blocking: the service calls it on its own thread.
 * Nothing here logs the token, the cookie, or what a response says.
 */
internal class ServerApi(context: Context, val origin: String) {
    private val auth = SessionAuth(context)

    @Volatile private var token: String? = null

    /**
     * Server clock minus the phone's (ms), from the latest refresh's Date header;
     * null until one has said. Task 12's ring rule compares the server's `startedAt`
     * with `System.currentTimeMillis() + serverOffsetMs`.
     */
    @Volatile var serverOffsetMs: Long? = null
        private set

    // A fingerprint of the sign-in cookie the token was got with (never the cookie itself).
    // When the WebView's cookie no longer matches it, someone may have signed out and in again.
    @Volatile private var cookieMark: Int? = null

    /** The server's clock, as well as the phone can tell. */
    fun serverNow(): Long = System.currentTimeMillis() + (serverOffsetMs ?: 0L)

    /** The token to use: the one kept, or a fresh one when there is none. Blocking. */
    fun token(deadline: Deadline? = null): AuthResult {
        token?.let { return AuthResult.Token(it, serverOffsetMs) }
        return refresh(deadline)
    }

    /** Forget the token kept; the next [token] asks the server for a new one. */
    fun invalidate() {
        token = null
    }

    /** Whether the WebView holds a sign-in for this server at all. No network. */
    fun hasSignIn(): Boolean = currentCookie() != null

    /** Whether the WebView's sign-in is no longer the one the kept token came from. No network. */
    fun signInChanged(): Boolean {
        val mark = cookieMark ?: return false // nothing got with a cookie yet: nothing to compare
        return currentCookie()?.hashCode() != mark
    }

    /**
     * A GET of [path] (with its query), as JSON. A refused token is refreshed once and the request tried again.
     * With a [deadline] everything it takes — the token, the request, the retry — fits in what is left of it,
     * and a lookup that someone is waiting on (a ringing phone) gives up as Unreachable instead of holding them.
     */
    fun get(path: String, deadline: Deadline? = null): ApiResult {
        val first = when (val a = token(deadline)) {
            is AuthResult.Token -> request(path, a.value, deadline)
            AuthResult.SignedOut -> return ApiResult.SignedOut
            AuthResult.Unreachable -> return ApiResult.Unreachable
        }
        if (first !is ApiResult.Status || first.code != 401) return first
        return when (val a = refresh(deadline)) {
            is AuthResult.Token -> request(path, a.value, deadline)
            AuthResult.SignedOut -> ApiResult.SignedOut
            AuthResult.Unreachable -> ApiResult.Unreachable
        }
    }

    private fun refresh(deadline: Deadline? = null): AuthResult {
        token = null
        val r = auth.accessToken(origin, deadline)
        if (r is AuthResult.Token) {
            token = r.value
            r.serverOffsetMs?.let { serverOffsetMs = it }
            // After the refresh: it may have written a re-issued cookie back into the WebView.
            cookieMark = currentCookie()?.hashCode()
        }
        return r
    }

    private fun currentCookie(): String? = try {
        RefreshCookie.from(CookieManager.getInstance().getCookie(origin))
    } catch (e: Exception) {
        null
    }

    private fun request(path: String, bearer: String, deadline: Deadline? = null): ApiResult {
        val timeoutMs = deadline?.timeoutMs(TIMEOUT_MS) ?: TIMEOUT_MS
        if (timeoutMs <= 0) return ApiResult.Unreachable
        val callEnd = System.nanoTime() + timeoutMs * 1_000_000L
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(origin + path).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            // Alone, each wait gets the full time; under a deadline the two share what is left.
            val (connectMs, readMs) = if (deadline == null) timeoutMs to timeoutMs else Deadline.connectAndRead(timeoutMs)
            conn.connectTimeout = connectMs
            conn.readTimeout = readMs
            // A redirect is not the server answering, and following one would carry the token elsewhere.
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.setRequestProperty("Authorization", "Bearer $bearer")
            conn.setRequestProperty("Accept", "application/json")
            val status = conn.responseCode
            if (status !in 200..299) return ApiResult.Status(status)
            val bodyBy = if (deadline != null) callEnd else System.nanoTime() + TIMEOUT_MS * 1_000_000L
            val text = String(conn.inputStream.use { it.readBounded(MAX_BYTES, bodyBy) }, Charsets.UTF_8)
            parse(text)?.let { ApiResult.Ok(it) } ?: ApiResult.Unreachable
        } catch (e: Exception) {
            // The class name only: some messages quote part of what was being read.
            Log.w(TAG, "a request to the server failed: ${e.javaClass.simpleName}")
            ApiResult.Unreachable
        } finally {
            conn?.disconnect()
        }
    }

    private fun parse(text: String): JSONObject? = try {
        JSONObject(text)
    } catch (e: Exception) {
        null
    } catch (e: StackOverflowError) {
        // Android's JSON parser recurses; absurd nesting from a broken server must not take the service down.
        null
    }

    /** Reads up to [max] bytes; throws once [deadline] (System.nanoTime) has passed, so a trickling server cannot hold the thread. */
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

    companion object {
        private const val TAG = "ServerApi"
        private const val TIMEOUT_MS = 10_000
        // A server with many channels, or groups with many members, is far below this.
        private const val MAX_BYTES = 4 * 1024 * 1024

        /** [id] as one path segment, whatever characters it holds. */
        fun segment(id: String): String = URLEncoder.encode(id, "UTF-8").replace("+", "%20")
    }
}
