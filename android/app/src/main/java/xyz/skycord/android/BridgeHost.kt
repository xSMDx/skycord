package xyz.skycord.android

import android.app.NotificationManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import xyz.skycord.android.core.AudioRoute
import xyz.skycord.android.core.BridgeProtocol
import xyz.skycord.android.core.Incoming
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.SavedServer
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.stringOrNull
import xyz.skycord.android.notify.NotifyService
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
        val CONVERSATION_KINDS = setOf("dm", "group", "channel")
        const val MAX_ID = 128
    }

    private val web: WebView get() = activity.web
    private val appShim = activity.assets.open("bridge/app-shim.js").use { String(it.readBytes()) }
    private val launcherShim = activity.assets.open("bridge/launcher-shim.js").use { String(it.readBytes()) }
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** The speaker button's side of a call (the `audio` bridge namespace); it tells the page when the route changes. */
    private val callAudio = CallAudio(activity, ::pushAudioRoute)

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
     * What the app asks of a server's page, held here until that page can hear it:
     * whether the app is in the background, and a tapped notification's conversation
     * or an answered call. A request from a notification can come before the page
     * exists (a cold start) or before it has said hello; it waits, and goes right
     * after the hello. Only the newest of each kind is kept, it is dropped once sent,
     * and it is sent only to the server it is for. (The page's shim then holds it
     * until the chat has subscribed, which happens only after sign-in.)
     */
    private class Request(val origin: String, val value: JSONObject)
    private var pendingJoin: Request? = null
    private var pendingOpen: Request? = null
    private var background: Boolean? = null
    private var sentBackground: Boolean? = null
    private var flushPosted = false

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
        pageLeft()
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
        callAudio.setCall(false)
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

    /**
     * The document that may have held a call is gone (a server switch, a reload, a page that has just said
     * hello): the call's sound goes back to the system and the screen may sleep again, whatever the page
     * had asked for, since it can no longer say so itself. Nothing is pushed to it.
     */
    private fun pageLeft() {
        callAudio.setCall(false)
        activity.keepScreenOn(false)
    }

    private fun pushAudioRoute(route: AudioRoute) {
        // Runs from the audio system's callback as well as from a call: a page that has gone away must
        // never turn a headset being plugged in into a crash.
        try {
            appProxy?.postMessage(BridgeProtocol.event("audioRoute", route.toJson()))
        } catch (e: Exception) {
            Log.w(TAG, "could not push the audio route to the page", e)
            appProxy = null
        }
    }

    private fun AudioRoute.toJson(): JSONObject = JSONObject().put("speaker", speaker).put("headset", headset)

    /** The app went to the background (true) or came back. The page keeps quiet while it is away. */
    fun setBackground(away: Boolean) {
        background = away
        scheduleFlush()
    }

    /** A tapped notification: open conversation [value] (`{ kind, id, serverId? }`) on [origin]'s page. */
    fun requestOpen(origin: String, value: JSONObject) {
        pendingOpen = Request(origin, value)
        scheduleFlush()
    }

    /** Answer on a call notification: join call [value] (`{ kind, convId }`) on [origin]'s page. */
    fun requestJoin(origin: String, value: JSONObject) {
        pendingJoin = Request(origin, value)
        scheduleFlush()
    }

    // Once the current message or lifecycle call has unwound: the activity's onNewIntent (which
    // sets a request) always comes before its onResume (which says it is back), and both land in
    // this one flush, which sends them in the order the page needs.
    private fun scheduleFlush() {
        if (flushPosted || closed) return
        flushPosted = true
        main.post {
            flushPosted = false
            if (!closed) flush()
        }
    }

    /**
     * Sends what is waiting to the current server's page, if it has said hello: an answered
     * call first, then a conversation to open, and only then "back in front" — so the page's
     * guard against ringing for the call being answered is up before it starts alerting again.
     */
    private fun flush() {
        val server = activity.currentServer ?: return
        val proxy = appProxy ?: return
        try {
            pendingJoin?.let { r ->
                pendingJoin = null
                if (r.origin == server) proxy.postMessage(BridgeProtocol.event("joinCall", r.value))
            }
            pendingOpen?.let { r ->
                pendingOpen = null
                if (r.origin == server) proxy.postMessage(BridgeProtocol.event("openConversation", r.value))
            }
            val away = background
            if (away != null && away != sentBackground) {
                proxy.postMessage(BridgeProtocol.event("background", away))
                sentBackground = away
            }
        } catch (e: Exception) {
            Log.w(TAG, "could not reach the page", e)
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
        // A page can make the shim post something other than a string (it only has to replace
        // JSON.stringify), and WebMessageCompat.data throws for an ArrayBuffer. A saved
        // server's page must never be able to crash the app, so look at the type before
        // touching the data and drop anything that goes wrong.
        if (message.type != WebMessageCompat.TYPE_STRING) return
        try {
            val origin = Origins.of(sourceOrigin.toString()) ?: return
            val incoming = message.data?.let(BridgeProtocol::parse) ?: return
            when {
                origin == MainActivity.LAUNCHER_ORIGIN && activity.currentServer == null -> onLauncher(incoming, proxy)
                origin == activity.currentServer -> onApp(incoming, proxy)
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "dropped a message", e)
        }
    }

    private fun onApp(m: Incoming, proxy: JavaScriptReplyProxy) {
        when (m) {
            Incoming.Hello -> {
                appProxy = proxy
                // A new document, whatever the page navigation hooks said before it: nothing in it is ready
                // yet (the web client has not even loaded), so the phone still notifies for this server. Its
                // "ready" comes much later, once the chat has signed in and subscribed (Incoming.Ready).
                activity.currentServer?.let { NotifyService.pageShown(activity, it) }
                // The first time a server's page is up is when the one-time questions are asked. They hang off
                // this hello, not off "ready": they are about the phone (permission, battery, calls), not the
                // page's account, and "ready" would hold them back until after sign-in, or for ever.
                later { activity.onServerPageUp() }
                // A new page (or a reload) knows nothing yet: it is told the state again, and gets
                // anything waiting for it.
                sentBackground = null
                scheduleFlush()
                // A reload ends the call its old document held; the new one starts from nothing.
                pageLeft()
            }
            // The web client subscribed to the background state (it does that only once signed in), or let go
            // of it (signed out, the chat closed). Only now is the page "in front": see FrontGate.
            is Incoming.Ready -> activity.currentServer?.let { NotifyService.pageReady(activity, it, m.up) }
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
                    // The conversation on screen: its notification goes and its next message alerts again.
                    "seen" -> convKeyOf(m.args.optJSONObject(0))?.let { NotifyService.seen(activity, it) }
                    "prefsChanged" -> NotifyService.prefsChanged(activity)
                    "androidNotifications.state" -> reply(notifyState())
                    "androidNotifications.setEnabled" -> (m.args.opt(0) as? Boolean)?.let { on ->
                        NotifyService.setEnabled(activity, on)
                        later { activity.syncNotifyService(leaving = false) }
                    }
                    "audio.state" -> reply(callAudio.state().toJson())
                    "audio.setCall" -> (m.args.opt(0) as? Boolean)?.let(callAudio::setCall)
                    "audio.setSpeaker" -> (m.args.opt(0) as? Boolean)?.let(callAudio::setSpeaker)
                    // The phone call screen: the screen stays lit while it is up.
                    "screen.keepOn" -> (m.args.opt(0) as? Boolean)?.let(activity::keepScreenOn)
                    "androidNotifications.openSystemSettings" -> later { activity.openNotificationSettings() }
                    "androidNotifications.requestBatteryExemption" -> later { activity.requestBatteryExemption() }
                    // A chat attachment's Download link, which the shim takes (WebView does nothing with an
                    // <a download> click): the URL and the link's name. The activity checks the address again.
                    "download" -> (m.args.opt(0) as? String)?.let { url ->
                        val name = m.args.opt(1) as? String
                        later { activity.saveAttachmentLink(url, name) }
                    }
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
                        try {
                            reply(
                                if (answer == null) JSONObject().put("unreachable", true)
                                else JSONObject().put("status", answer.status).put("body", answer.body),
                            )
                        } catch (e: RuntimeException) {
                            Log.w(TAG, "could not answer the lookup", e)
                        }
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
                // Removing the last server used ends its background connection, and its notifications.
                later { activity.syncNotifyService(leaving = false) }
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

    /**
     * A `seen` call's `{ kind, id }` as a notification key ("dm:…", "group:…", "channel:…"),
     * or null when it is not one. Strict, as every call is: a page cannot name anything else.
     */
    private fun convKeyOf(o: JSONObject?): String? {
        val kind = o?.opt("kind") as? String ?: return null
        val id = o.opt("id") as? String ?: return null
        if (kind !in CONVERSATION_KINDS || id.isEmpty() || id.length > MAX_ID) return null
        return "$kind:$id"
    }

    /** Settings › Notifications' Android rows (desktopBridge.ts AndroidNotifyState). */
    private fun notifyState(): JSONObject {
        val nm = activity.getSystemService(NotificationManager::class.java)
        val power = activity.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("enabled", NotifyService.isEnabled(activity))
            .put("permission", NotificationManagerCompat.from(activity).areNotificationsEnabled())
            .put("batteryExempt", power?.isIgnoringBatteryOptimizations(activity.packageName) == true)
            // Android 14 made full-screen incoming calls a permission of its own; before, every app had it.
            .put("fullScreenCalls", Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE || nm?.canUseFullScreenIntent() == true)
            // An older server (no catch-up route) also ignores that this connection is only listening: while it
            // listens, the person shows as online. The page says so.
            .put("legacyServer", NotifyService.legacyServer)
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
