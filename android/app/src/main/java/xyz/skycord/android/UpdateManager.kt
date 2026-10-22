package xyz.skycord.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import xyz.skycord.android.core.Feed
import xyz.skycord.android.core.UpdateEvent
import xyz.skycord.android.core.UpdateFeed
import xyz.skycord.android.core.UpdatePhase
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.reduce
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Checks latest.json, downloads a newer APK, checks it against the feed's
 * SHA-256, and hands it to Android's installer when the person taps Install.
 * Every change goes through the shared reducer, so the web's Updates page sees
 * exactly what it sees on the desktop.
 *
 * Nothing the feed or the server sends may crash the app: bodies and downloads
 * are size- and time-bounded, and each background job catches everything.
 */
class UpdateManager(private val activity: Activity, private val onChange: (UpdateState) -> Unit) {
    @Volatile
    var state: UpdateState = UpdateState.INITIAL
        private set

    private val appContext = activity.applicationContext
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** True from the moment a check is accepted until its background job is done. */
    private val busy = AtomicBoolean(false)

    /** The verified download waiting for Install, if any. */
    @Volatile
    private var apk: File? = null

    @Volatile
    private var closed = false

    private fun emit(e: UpdateEvent) {
        if (closed) return
        main.post { if (!closed) { state = reduce(state, e); onChange(state) } }
    }

    private fun fail(message: String, cause: Throwable? = null) {
        Log.w(TAG, message, cause)
        emit(UpdateEvent.Error(message, System.currentTimeMillis()))
    }

    /** Debug builds never offer a release over themselves. */
    fun checkOnLaunch() { if (!BuildConfig.DEBUG) check() }

    fun check() {
        if (closed) return
        // A downloaded update is waiting for Install; the next launch looks again.
        if (state.phase == UpdatePhase.READY && apk?.exists() == true) return
        if (!busy.compareAndSet(false, true)) return
        emit(UpdateEvent.Check)
        try {
            io.execute {
                try {
                    val feed = fetchText(UpdateFeed.FEED_URL)?.let(UpdateFeed::parse)
                    when {
                        feed == null -> fail("couldn’t read the update feed")
                        !UpdateFeed.isNewer(feed.version, BuildConfig.VERSION_NAME) -> emit(UpdateEvent.None(System.currentTimeMillis()))
                        else -> { emit(UpdateEvent.Available(feed.version)); download(feed) }
                    }
                } catch (e: Throwable) {
                    fail("couldn’t check for updates", e)
                } finally {
                    busy.set(false)
                }
            }
        } catch (e: RejectedExecutionException) {
            busy.set(false)
        }
    }

    private fun download(feed: Feed) {
        val dir = File(appContext.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, "skycord-${feed.version}.apk")
        val part = File(dir, "${file.name}.part")
        // Only other versions' leftovers go: the target may already be a verified download.
        dir.listFiles()?.filter { it != file && it != part }?.forEach { it.delete() }
        apk = null
        var conn: HttpURLConnection? = null
        try {
            if (file.exists()) {
                // Left by an earlier run (e.g. the process died during the "Install unknown apps" detour).
                if (sha256Of(file) == feed.sha256) {
                    part.delete()
                    apk = file
                    emit(UpdateEvent.Downloaded(feed.version))
                    return
                }
                file.delete()
            }
            conn = URL(feed.url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            if (conn.responseCode != 200) {
                fail("the download wasn’t available")
                return
            }
            emit(UpdateEvent.Progress(0.0, 0.0))
            val sha = receive(conn, part)
            if (sha != feed.sha256) {
                fail("the download didn’t match what was published")
                return
            }
            if (!part.renameTo(file)) throw IOException("couldn’t move the verified download into place")
            apk = file
            emit(UpdateEvent.Downloaded(feed.version))
        } catch (e: Exception) {
            fail("the download stopped", e)
        } finally {
            conn?.disconnect()
            part.delete() // Gone already after a successful rename.
        }
    }

    /** Writes the response to [part] and returns its SHA-256; throws when it runs over the size ceiling or the deadline. */
    private fun receive(conn: HttpURLConnection, part: File): String {
        val total = conn.contentLengthLong.takeIf { it > 0 }
        if (total != null && total > MAX_APK_BYTES) throw IOException("the update is larger than $MAX_APK_BYTES bytes")
        val digest = MessageDigest.getInstance("SHA-256")
        val started = SystemClock.elapsedRealtime()
        var read = 0L
        var lastEmit = 0L
        conn.inputStream.use { input ->
            part.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    read += n
                    val now = SystemClock.elapsedRealtime()
                    if (read > MAX_APK_BYTES) throw IOException("the update is larger than $MAX_APK_BYTES bytes")
                    if (now - started > DOWNLOAD_DEADLINE_MS) throw IOException("the download ran past its time limit")
                    if (closed) throw IOException("the app is closing")
                    out.write(buf, 0, n)
                    digest.update(buf, 0, n)
                    if (total != null && now - lastEmit > 250) {
                        lastEmit = now
                        val bps = read * 1000.0 / maxOf(1L, now - started)
                        emit(UpdateEvent.Progress(read * 100.0 / total, bps))
                    }
                }
            }
        }
        return digest.digest().toHex()
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    fun install() {
        if (closed || state.phase != UpdatePhase.READY) return
        val file = apk?.takeIf { it.exists() }
        if (file == null) {
            apk = null
            fail("couldn’t find the downloaded update")
            return
        }
        try {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                // Android asks once per app. After allowing it, Install works.
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                return
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            )
        } catch (e: ActivityNotFoundException) {
            fail("couldn’t open Android’s installer", e)
        } catch (e: IllegalArgumentException) {
            fail("couldn’t open Android’s installer", e)
        } catch (e: SecurityException) {
            // Some OEM and work-profile setups refuse the installer or the settings page.
            fail("couldn’t open Android’s installer", e)
        }
    }

    /** Stops background work and silences later events; called when the activity goes away. */
    fun close() {
        closed = true
        io.shutdownNow()
        main.removeCallbacksAndMessages(null)
    }

    /** The feed body, or null when it isn't a 200, runs past the size cap (rejected, not cut short), or stalls. */
    private fun fetchText(url: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            if (conn.responseCode != 200) return null
            val limit = UpdateFeed.MAX_FEED_BYTES + 1
            val started = SystemClock.elapsedRealtime()
            val body = conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8 * 1024)
                while (out.size() < limit) {
                    if (SystemClock.elapsedRealtime() - started > FEED_DEADLINE_MS) throw IOException("the feed took too long")
                    val n = input.read(buf, 0, minOf(buf.size, limit - out.size()))
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
            if (body.size > UpdateFeed.MAX_FEED_BYTES) null else String(body, Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "couldn’t fetch the update feed", e)
            null
        } finally {
            conn?.disconnect()
        }
    }

    private companion object {
        const val TAG = "SkycordUpdates"
        const val MAX_APK_BYTES = 200L * 1024 * 1024
        const val DOWNLOAD_DEADLINE_MS = 10 * 60 * 1000L
        const val FEED_DEADLINE_MS = 30 * 1000L
    }
}
