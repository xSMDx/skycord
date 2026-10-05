package xyz.skycord.android

import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import xyz.skycord.android.core.BridgeProtocol
import xyz.skycord.android.core.Incoming
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.SavedServer
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.stringOrNull
import java.util.concurrent.Executors

/**
 * The bridge between pages and the app. One message listener, registered for
 * the saved servers' origins and the launcher's; two document-start shims,
 * each only where it belongs. Every message is checked again here — main frame
 * only, and its origin must be the current server (app calls) or the
 * launcher (launcher calls) — so a page can never reach what it should not,
 * whatever the registration says.
 */
class BridgeHost(private val activity: MainActivity) {
    private companion object {
        const val PORT = "__skycordPort"
        const val TAG = "SkycordBridge"
    }

    private val web: WebView get() = activity.web
    private val appShim = activity.assets.open("bridge/app-shim.js").use { String(it.readBytes()) }
    private val launcherShim = activity.assets.open("bridge/launcher-shim.js").use { String(it.readBytes()) }
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private var listening = false
    private var appScript: ScriptHandler? = null
    private var launcherScript: ScriptHandler? = null

    /**
     * Bumped whenever the listener is replaced or the bridge closes. Replacing
     * the listener destroys every reply proxy the old one handed out, and
     * posting to one (WebView offers no way to ask) crashes the process
     * natively, so anything that answers later — after network I/O, or after
     * the current message has unwound — checks it first and stays silent when
     * it has moved on.
     */
    private var generation = 0
    private var closed = false

    /**
     * The current server page's way back to its bridge, from its hello. The
     * newest hello always wins — a reload sends a new one — and it is cleared
     * whenever the server changes. (Not on onPageStarted: that and the new
     * page's hello arrive in no fixed order, and clearing after the hello
     * would leave the back button unoffered.)
     */
    private var appProxy: JavaScriptReplyProxy? = null

    var onBackAnswer: (Int, Boolean) -> Unit = { _, _ -> }

    /**
     * Register for the current saved servers; takes effect from the next page
     * load. Called by the activity just before each navigation, never from a
     * message handler. If WebView refuses a saved origin as a rule (an IPv6
     * literal, say) the launch must not crash: it falls back to the current
     * server alone, and then to the launcher alone.
     */
    fun refresh() {
        generation++
        appProxy = null
        unregister()
        val saved = activity.store.list().map { it.origin }.toSet()
        val attempts = listOf(saved, setOfNotNull(activity.currentServer), emptySet<String>()).distinct()
        for (servers in attempts.dropLast(1)) {
            try {
                register(servers)
                if (servers != saved) Log.w(TAG, "WebView refused some origins; the bridge is on for $servers, skipped ${saved - servers}")
                return
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "WebView refused the bridge for $servers", e)
                unregister()
            }
        }
        register(attempts.last())
        if (saved.isNotEmpty()) Log.w(TAG, "the bridge is on for the launcher only, skipped $saved")
    }

    private fun register(servers: Set<String>) {
        WebViewCompat.addWebMessageListener(web, PORT, servers + MainActivity.LAUNCHER_ORIGIN, ::onMessage)
        listening = true
        appScript = if (servers.isEmpty()) null else WebViewCompat.addDocumentStartJavaScript(web, appShim, servers)
        launcherScript = WebViewCompat.addDocumentStartJavaScript(web, launcherShim, setOf(MainActivity.LAUNCHER_ORIGIN))
    }

    private fun unregister() {
        if (listening) WebViewCompat.removeWebMessageListener(web, PORT)
        listening = false
        appScript?.remove()
        launcherScript?.remove()
        appScript = null
        launcherScript = null
    }

    /** The activity is going away: no more replies, no more lookups. */
    fun close() {
        closed = true
        generation++
        appProxy = null
        main.removeCallbacksAndMessages(null)
        io.shutdownNow()
    }

    /**
     * Runs on the main thread once the current message has unwound, unless the
     * bridge has moved on since [at] (a refresh or a close).
     */
    private fun later(at: Int = generation, block: () -> Unit) {
        main.post { if (!closed && at == generation) block() }
    }

    fun pushUpdates(state: UpdateState) {
        // Runs inside the update manager's main-thread callback: a page that has
        // gone away must never turn an update event into a crash.
        try {
            appProxy?.postMessage(BridgeProtocol.event("updates", state.toJson()))
        } catch (e: Exception) {
            Log.w(TAG, "could not push the update state to the page", e)
            appProxy = null
        }
    }

    /** Offer the back button to the page. False when the page has no bridge to ask. */
    fun askBack(id: Int): Boolean {
        if (activity.currentServer == null) return false
        val proxy = appProxy ?: return false
        return try {
            proxy.postMessage(BridgeProtocol.event("back", id))
            true
        } catch (e: Exception) {
            Log.w(TAG, "could not offer the back button to the page", e)
            appProxy = null
            false
        }
    }

    private fun onMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, proxy: JavaScriptReplyProxy) {
        if (closed || !isMainFrame) return
        val origin = Origins.of(sourceOrigin.toString()) ?: return
        val incoming = message.data?.let(BridgeProtocol::parse) ?: return
        when {
            origin == MainActivity.LAUNCHER_ORIGIN && activity.currentServer == null -> onLauncher(incoming, proxy)
            origin == activity.currentServer -> onApp(incoming, proxy)
        }
    }

    private fun onApp(m: Incoming, proxy: JavaScriptReplyProxy) {
        when (m) {
            Incoming.Hello -> appProxy = proxy
            is Incoming.BackAnswer -> onBackAnswer(m.id, m.used)
            is Incoming.Call -> {
                val reply = { value: Any? -> m.id?.let { proxy.postMessage(BridgeProtocol.reply(it, value)) } }
                when (m.method) {
                    // Reply first, then navigate once this message has unwound: navigating replaces
                    // the listener whose callback we are still inside.
                    "changeInstance", "openServers" -> { reply(null); later { activity.showLauncher() } }
                    "colors" -> m.args.optJSONObject(0)?.optString("bar")?.let(activity::applyBarColour)
                    "about" -> reply(about())
                    "updates.state" -> reply(activity.updates.state.toJson())
                    "updates.check" -> activity.updates.check()
                    "updates.install" -> activity.updates.install()
                    else -> m.id?.let { proxy.postMessage(BridgeProtocol.error(it, "unknown method")) }
                }
            }
        }
    }

    private fun onLauncher(m: Incoming, proxy: JavaScriptReplyProxy) {
        val call = m as? Incoming.Call ?: return
        val id = call.id ?: return
        val reply = { value: Any? -> proxy.postMessage(BridgeProtocol.reply(id, value)) }
        val servers = { list: List<SavedServer> -> JSONArray(list.map { it.toJson() }) }
        when (call.method) {
            "launcher.list" -> reply(
                JSONObject()
                    .put("servers", servers(activity.store.list()))
                    .put("current", activity.currentServer ?: JSONObject.NULL)
                    .put("hosted", "https://app.skycord.xyz"),
            )
            "launcher.lookup" -> {
                val origin = call.args.optString(0)
                // Only an origin that is already normal; never a URL the page chose.
                if (Origins.normalise(origin) != origin) { reply(JSONObject().put("unreachable", true)); return }
                val at = generation
                io.execute {
                    val answer = InstanceFetch.get(origin)
                    // Seconds may have passed; if the page was left meanwhile, its proxy is gone.
                    later(at) {
                        reply(
                            if (answer == null) JSONObject().put("unreachable", true)
                            else JSONObject().put("status", answer.status).put("body", answer.body),
                        )
                    }
                }
            }
            "launcher.save" -> {
                val e = call.args.optJSONObject(0) ?: return reply(servers(activity.store.list()))
                // No refresh() here: replacing the listener destroys this page's reply proxy
                // (posting to it afterwards crashes WebView natively) and cuts its port, which
                // the page still needs for the open that follows. openServer and showLauncher
                // refresh just before they load, which is when a new registration is needed.
                val wanted = e.stringOrNull("origin") ?: ""
                // The launcher is not a server; saving it would let it open itself as one.
                if (Origins.normalise(wanted) == MainActivity.LAUNCHER_ORIGIN) return reply(servers(activity.store.list()))
                val list = activity.store.save(wanted, e.stringOrNull("name"), e.stringOrNull("icon"))
                reply(servers(list))
            }
            "launcher.remove" -> {
                val list = activity.store.remove(call.args.optString(0))
                reply(servers(list))
            }
            "launcher.open" -> {
                val origin = call.args.optString(0)
                if (origin == MainActivity.LAUNCHER_ORIGIN || activity.store.find(origin) == null) {
                    proxy.postMessage(BridgeProtocol.error(id, "not a saved server"))
                    return
                }
                reply(null)
                // Checked again at the time: a remove may have slipped in between.
                later { if (activity.store.find(origin) != null) activity.openServer(origin) }
            }
            else -> proxy.postMessage(BridgeProtocol.error(id, "unknown method"))
        }
    }

    /** The desktop's AboutFacts shape, so the web's Debug page reads it unchanged. */
    private fun about(): JSONObject = JSONObject()
        .put("app", BuildConfig.VERSION_NAME)
        .put("electron", "")
        .put("chromium", WebViewCompat.getCurrentWebViewPackage(activity)?.versionName ?: "")
        .put("node", "")
        .put("platform", "android")
        .put("osVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        .put("addonLoaded", false)
        .put("perAppAudio", false)
}
