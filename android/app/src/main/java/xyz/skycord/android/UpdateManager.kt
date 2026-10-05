package xyz.skycord.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import xyz.skycord.android.core.Feed
import xyz.skycord.android.core.UpdateEvent
import xyz.skycord.android.core.UpdateFeed
import xyz.skycord.android.core.UpdatePhase
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.reduce
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Checks latest.json, downloads a newer APK, checks it against the feed's
 * SHA-256, and hands it to Android's installer when the person taps Install.
 * Every change goes through the shared reducer, so the web's Updates page sees
 * exactly what it sees on the desktop.
 */
class UpdateManager(private val activity: Activity, private val onChange: (UpdateState) -> Unit) {
    var state: UpdateState = UpdateState.INITIAL
        private set

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var apk: File? = null

    private fun emit(e: UpdateEvent) = main.post { state = reduce(state, e); onChange(state) }

    /** Debug builds never offer a release over themselves. */
    fun checkOnLaunch() { if (!BuildConfig.DEBUG) check() }

    fun check() {
        if (state.phase == UpdatePhase.CHECKING || state.phase == UpdatePhase.DOWNLOADING) return
        emit(UpdateEvent.Check)
        io.execute {
            val feed = fetchText(UpdateFeed.FEED_URL)?.let(UpdateFeed::parse)
            when {
                feed == null -> emit(UpdateEvent.Error("couldn't read the update feed", System.currentTimeMillis()))
                !UpdateFeed.isNewer(feed.version, BuildConfig.VERSION_NAME) -> emit(UpdateEvent.None(System.currentTimeMillis()))
                else -> { emit(UpdateEvent.Available(feed.version)); download(feed) }
            }
        }
    }

    private fun download(feed: Feed) {
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "skycord-${feed.version}.apk")
        try {
            val conn = URL(feed.url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            val total = conn.contentLengthLong.takeIf { it > 0 }
            val digest = MessageDigest.getInstance("SHA-256")
            val started = System.currentTimeMillis()
            var read = 0L
            var lastEmit = 0L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        read += n
                        val now = System.currentTimeMillis()
                        if (total != null && now - lastEmit > 250) {
                            lastEmit = now
                            val bps = read * 1000.0 / maxOf(1L, now - started)
                            emit(UpdateEvent.Progress(read * 100.0 / total, bps))
                        }
                    }
                }
            }
            conn.disconnect()
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (sha != feed.sha256) {
                file.delete()
                emit(UpdateEvent.Error("the download didn't match what was published", System.currentTimeMillis()))
                return
            }
            apk = file
            emit(UpdateEvent.Downloaded(feed.version))
        } catch (e: Exception) {
            file.delete()
            emit(UpdateEvent.Error("the download stopped", System.currentTimeMillis()))
        }
    }

    fun install() {
        val file = apk ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Android asks once per app. After allowing it, Install works.
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun fetchText(url: String): String? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        try {
            if (conn.responseCode == 200) conn.inputStream.use { String(it.readBytes(), Charsets.UTF_8) } else null
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        null
    }
}
