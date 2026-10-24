package xyz.skycord.android

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import xyz.skycord.android.core.BackAction
import xyz.skycord.android.core.BackGate
import xyz.skycord.android.core.CssColor
import xyz.skycord.android.core.Nav
import xyz.skycord.android.core.NavigationPolicy
import xyz.skycord.android.core.NoticeEntry
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.PickerTypes
import xyz.skycord.android.core.PromptOnce
import xyz.skycord.android.core.RefreshCookie
import xyz.skycord.android.core.ServerStore
import xyz.skycord.android.notify.CallRinger
import xyz.skycord.android.notify.Notifier
import xyz.skycord.android.notify.NotifyHub
import xyz.skycord.android.notify.NotifyService

class MainActivity : AppCompatActivity() {
    companion object {
        const val LAUNCHER_ORIGIN = "https://appassets.androidplatform.net"
        const val LAUNCHER_URL = "$LAUNCHER_ORIGIN/assets/launcher/index.html"
        /** The launcher shortcut "Choose a server" (res/xml/shortcuts.xml) sends this. */
        const val ACTION_CHOOSE_SERVER = "xyz.skycord.android.action.CHOOSE_SERVER"
        /**
         * A tapped message notification (notify/Notifier) sends these: the conversation to open,
         * as the page names it ("dm", "group" or "channel", and its id), a channel's server id
         * (the page needs it to find the channel), and the origin of the server the notice came from.
         */
        const val EXTRA_OPEN_KIND = "xyz.skycord.android.extra.OPEN_KIND"
        const val EXTRA_OPEN_ID = "xyz.skycord.android.extra.OPEN_ID"
        const val EXTRA_OPEN_SERVER = "xyz.skycord.android.extra.OPEN_SERVER"
        const val EXTRA_OPEN_ORIGIN = "xyz.skycord.android.extra.OPEN_ORIGIN"
        /**
         * Answer on a call notification (Task 12) sends these: the call to join, as the page
         * names it ("dm" with the partner's id, or "group" with the group's), with
         * [EXTRA_OPEN_ORIGIN] for the server it rang on.
         */
        const val EXTRA_JOIN_KIND = "xyz.skycord.android.extra.JOIN_KIND"
        const val EXTRA_JOIN_ID = "xyz.skycord.android.extra.JOIN_ID"
        /**
         * Which ring this Answer is for (the call's room). With it the app ends that ring, and refuses an
         * Answer whose ring has already ended (the caller hung up while the person unlocked), so a late
         * Answer never starts a new call. Absent, nothing is checked.
         */
        const val EXTRA_JOIN_ROOM = "xyz.skycord.android.extra.JOIN_ROOM"
        private const val MAX_ROOM = 200

        /**
         * The intent every notification, ring, missed-call tap and Answer starts the app with: MainActivity
         * through its private, non-exported alias ([NoticeEntry]). Only an intent that came this way has its
         * open/join extras honoured, so another app cannot make Skycord join a call or switch servers.
         */
        fun noticeIntent(context: Context): Intent = Intent().setClassName(context, NoticeEntry.ALIAS)

        /** The one-time questions' keys (core/PromptOnce). */
        private const val ASKED_NOTIFICATIONS = "post_notifications"
        private const val ASKED_BATTERY = "battery"
        private const val ASKED_FULL_SCREEN = "full_screen"

        private const val WEBVIEW_PACKAGE = "com.google.android.webview"
        private val OPEN_KINDS = setOf("dm", "group", "channel")
        private val JOIN_KINDS = setOf("dm", "group")
    }

    lateinit var web: WebView
        private set
    lateinit var store: ServerStore
        private set
    lateinit var updates: UpdateManager
        private set
    lateinit var bridge: BridgeHost
        private set

    /** The server whose page is showing; null on the launcher. */
    var currentServer: String? = null
        private set

    private lateinit var root: View
    private lateinit var unreachable: View
    private lateinit var assetLoader: WebViewAssetLoader
    private var pendingPermission: Pair<PermissionRequest, List<String>>? = null

    // Per openServer: whether the page has loaded once, and whether the current load failed.
    private var serverLoaded = false
    private var loadFailed = false

    // Each openServer/showLauncher starts a fresh history: otherwise a server page's
    // history.back() could land on the launcher entry while currentServer is set,
    // where every launcher call is refused (history moves skip shouldOverrideUrlLoading).
    private var clearHistoryOnFinish = false

    private val backGate = BackGate()
    private val main = Handler(Looper.getMainLooper())

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val (request, resources) = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val granted = resources.filter { ContextCompat.checkSelfPermission(this, androidPermissionFor(it)) == PackageManager.PERMISSION_GRANTED }
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    /** The page waiting for files; answered exactly once, with null on cancel. */
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        callback.onReceiveValue(pickedUris(result.resultCode, result.data))
    }

    // The one-time questions (askFirstRun): at most one on screen, whichever it is.
    private var asking = false
    private var questionDialog: AlertDialog? = null

    /** A server's page is up (it said hello) and has not been left for another since: the questions may be asked. */
    private var serverPageUp = false

    /** Between onResume and onPause: a dialog or a system screen can be put in front of the person. */
    private var resumed = false

    private val askNotificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        asking = false
        // Allowed just now: Android lets the app show notices, so the background connection can start.
        syncNotifyService(leaving = false)
        askFirstRun()
    }

    /** A system screen the person is sent to (battery exemption, full-screen calls); the next question waits until they are back. */
    private val askSystemScreen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        asking = false
        askFirstRun()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Transparent bars on every Android version (the root view behind them carries the colour),
        // so the old-WebView screen gets the same treatment.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        if (!webViewIsNewEnough()) {
            showOldWebView()
            return
        }
        // Below API 30 the keyboard inset only reaches the insets listener under adjustResize.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            @Suppress("DEPRECATION") // deprecated from API 30, which is exactly where this stops being needed
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        unreachable = findViewById(R.id.unreachable)
        SystemBars.install(window, root)

        store = ServerStore(PrefsKeyValue(this))
        updates = UpdateManager(this) { onUpdateState() }
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        configureWebView()

        findViewById<Button>(R.id.unreachable_retry).setOnClickListener { currentServer?.let(::openServer) }
        findViewById<Button>(R.id.unreachable_choose).setOnClickListener { showLauncher() }

        onCreateBridge()

        // A notification that started the app names its server; otherwise the one used last. A
        // restored activity (or one opened from Recents) is handed its old intent again, which must
        // not reopen a conversation the person has long since left.
        val notice = intent?.takeIf { savedInstanceState == null && !launchedFromHistory(it) }?.let(::noticeRequest)
        // The shortcut asks for the server list, not the server the app last had open.
        val first = notice?.origin ?: store.last()
        if (intent?.action == ACTION_CHOOSE_SERVER || first == null) showLauncher() else openServer(first)
        notice?.let(::deliver)
        updates.checkOnLaunch()
    }

    // singleTask: a running app gets the launcher shortcut here, not in onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // `web` is unset on the old-WebView screen, which has no server list to show. Already on the
        // launcher (currentServer is null): leave it alone, so a half-typed address isn't wiped.
        if (intent.action == ACTION_CHOOSE_SERVER && ::web.isInitialized && currentServer != null) showLauncher()
        // A notification tapped (or a call answered) while the app was running.
        if (::web.isInitialized && !launchedFromHistory(intent)) {
            noticeRequest(intent)?.let { request ->
                // A notification from another saved server than the one showing: that server first.
                if (request.origin != currentServer) openServer(request.origin)
                deliver(request)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Before anything else: from now on the page has the sounds, and the service posts nothing.
        NotifyService.setForeground(this, true)
    }

    override fun onResume() {
        super.onResume()
        // Not `lifecycle.currentState`: it reaches RESUMED only after this method has returned.
        resumed = true
        // The launch check has just set the time, so the first onResume after onCreate does not repeat it.
        if (::updates.isInitialized) updates.checkIfStale()
        if (::bridge.isInitialized) {
            // Here rather than in onStart: onNewIntent, with an answered call, always comes before
            // onResume, so the page hears "join" before "back in front" (BridgeHost.flush).
            bridge.setBackground(false)
            // A call still ringing on the phone is the page's to ring now. After onNewIntent (an Answer has
            // ended its own ring there), which onStart is not: see NotifyService.pageTakesOver.
            NotifyService.pageTakesOver(this)
            // Back from Android's settings, where notifications may just have been allowed.
            syncNotifyService(leaving = false)
            // A question that had to wait for the app to be on screen again.
            askFirstRun()
        }
    }

    override fun onStop() {
        super.onStop()
        NotifyService.setForeground(this, false)
        if (::bridge.isInitialized) {
            bridge.setBackground(true)
            // Leaving is when a sign-in made, or ended, in the page while it was on screen counts.
            syncNotifyService(leaving = true)
        }
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        // Keep each server's sign-in if the process is killed while we are in the background.
        // `web` is unset on the old-WebView screen, where there may be no WebView provider at all.
        if (::web.isInitialized) CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        // A question still on screen has no activity left to answer to.
        questionDialog?.dismiss()
        questionDialog = null
        // A page still waiting for files must be answered (null: nothing picked), or its file input stays stuck.
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        // A back offer still waiting for its 300 ms timeout has nothing left to act on.
        main.removeCallbacksAndMessages(null)
        // onCreate returns early on the old-WebView screen, before updates exists.
        if (::updates.isInitialized) updates.close()
        if (::bridge.isInitialized) bridge.close()
        super.onDestroy()
    }

    // No refresh here: the first openServer or showLauncher registers, just before it loads.
    private fun onCreateBridge() {
        bridge = BridgeHost(this)
        bridge.onBackAnswer = { id, used -> backGate.answer(id, used)?.let(::act) }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
    }

    /** Offered to the page first; 300 ms of silence counts as unused. */
    private fun onBack() {
        val id = backGate.ask()
        if (!bridge.askBack(id)) { backGate.timeout(id)?.let(::act); return }
        main.postDelayed({ backGate.timeout(id)?.let(::act) }, backGate.timeoutMs)
    }

    private fun act(action: BackAction) {
        if (action != BackAction.TO_BACKGROUND) return
        // The page didn't use it: step back through this server's pages, and only then leave the app.
        // Not while clearHistoryOnFinish is set: until the load finishes the history is still
        // [launcher, server], and a history move onto the launcher entry skips shouldOverrideUrlLoading,
        // leaving a launcher whose calls are all refused.
        if (currentServer != null && !clearHistoryOnFinish && web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    private fun onUpdateState() {
        if (::bridge.isInitialized) bridge.pushUpdates(updates.state)
    }

    // With no usable WebView provider the feature checks can throw; the old-WebView screen is the right answer then.
    private fun webViewIsNewEnough(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    } catch (e: Exception) {
        false
    }

    private fun showOldWebView() {
        setContentView(R.layout.screen_old_webview)
        findViewById<Button>(R.id.old_webview_update).setOnClickListener {
            openExternally(Uri.parse("market://details?id=$WEBVIEW_PACKAGE"))
                || openExternally(Uri.parse("https://play.google.com/store/apps/details?id=$WEBVIEW_PACKAGE"))
        }
    }

    private fun configureWebView() {
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString SkycordAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return when (NavigationPolicy.decide(request.url.toString(), currentServer, LAUNCHER_ORIGIN)) {
                    Nav.STAY -> false
                    Nav.BROWSER -> { openExternally(request.url); true }
                    Nav.BLOCK -> true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
                val server = currentServer ?: return
                if (!request.isForMainFrame || Origins.of(request.url.toString()) != server) return
                loadFailed = true
                // Only a server that never loaded gets the native screen; once the page has
                // loaded, a dropped connection or a failed reload is the web app's own business.
                if (!serverLoaded) showUnreachable(server)
            }

            // A server that answers with an error page (WebView shows its body, and onReceivedError never
            // fires) gets the same screen as one that can't be reached. Only before the page has loaded:
            // later errors are the web app's own business.
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                val server = currentServer ?: return
                if (!request.isForMainFrame || Origins.of(request.url.toString()) != server) return
                if (errorResponse.statusCode < 500 || serverLoaded) return
                loadFailed = true
                showUnreachable(server)
            }

            // A page of the current server has begun loading — a reload, a redirect, a link inside it:
            // a new document that has to sign in and subscribe all over again, so it is not "in front"
            // until it says so (its hello resets it too, and its "ready" comes much later). Only the
            // current server's own origin; a late callback for the page just left changes nothing.
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                val server = currentServer ?: return
                if (Origins.of(url) == server) NotifyService.pageShown(this@MainActivity, server)
            }

            override fun onPageFinished(view: WebView, url: String) {
                // Only the page just asked for ends it, not an earlier page finishing late.
                if (clearHistoryOnFinish && Origins.of(url) == (currentServer ?: LAUNCHER_ORIGIN)) {
                    clearHistoryOnFinish = false
                    view.clearHistory()
                }
                // WebView also calls this after a failed load (for its error page), hence loadFailed.
                if (currentServer != null && Origins.of(url) == currentServer && !loadFailed) serverLoaded = true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = handlePermission(request)

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
                showFilePicker(view, callback, params)

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingPermission?.first == request) pendingPermission = null
            }
        }
    }

    fun openServer(origin: String) {
        unreachable.visibility = View.GONE
        serverLoaded = false
        loadFailed = false
        clearHistoryOnFinish = true
        currentServer = origin
        store.setLast(origin)
        onServerChanged()
        web.loadUrl("$origin/")
    }

    fun showLauncher() {
        unreachable.visibility = View.GONE
        clearHistoryOnFinish = true
        currentServer = null
        onServerChanged()
        web.loadUrl(LAUNCHER_URL)
    }

    private fun onServerChanged() {
        // A new page (or the launcher) is loading: the questions wait for its hello.
        serverPageUp = false
        if (::bridge.isInitialized) bridge.refresh()
        // A new page (or the launcher) is being loaded: it is not ready, so the phone still notifies for this
        // server until the page's web client says it is (NotifyService.pageReady, from the bridge).
        NotifyService.pageShown(this, currentServer)
        // The background connection follows the last server used (Review Focus 2).
        syncNotifyService(leaving = false)
    }

    // ---- the background connection (notify/NotifyService) ------------------------------------------

    /**
     * Starts, points or stops the background connection to match the app: it runs for the
     * last server used while background notifications are on, Android lets them show, and
     * that server holds a sign-in. Called whenever one of those may have changed, and when
     * the app is left ([leaving]), which is when a sign-out made in the page counts: the
     * service then finds the sign-in gone, says "Signed out", and stops. A server never
     * signed in to gets no service, and so no such notice.
     */
    fun syncNotifyService(leaving: Boolean) {
        if (!::store.isInitialized) return
        val target = store.last()?.takeIf {
            NotifyService.isEnabled(this) && NotificationManagerCompat.from(this).areNotificationsEnabled()
        }
        val running = NotifyService.runningOrigin
        if (target == null) {
            // Off, or not allowed to show anything; and a server no longer saved takes its notices with it.
            if (running != null) NotifyService.stop(this, clearNotices = running != store.last() || store.find(running) == null)
            return
        }
        val signedIn = try {
            RefreshCookie.from(CookieManager.getInstance().getCookie(target)) != null
        } catch (e: Exception) {
            false
        }
        when {
            signedIn -> NotifyService.start(this, target)
            running == target && leaving -> NotifyService.start(this, target)
            running == target -> {} // signed out in the page just now; decided when the app is left
            running != null -> NotifyService.stop(this, clearNotices = true) // another server's: its notices go with it
        }
    }

    /** Android's notification settings for the app, where each channel can be changed. */
    fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w("MainActivity", "no notification settings screen on this phone")
        }
    }

    /**
     * Settings › Notifications' "Allow" for battery limits: the person has just asked, so Android's own
     * "let it run in the background?" request goes straight up, with no explanation of ours and no
     * once-only rule (that is for the unprompted first-run question, [askFirstRun]).
     */
    fun requestBatteryExemption() {
        // Only from a page the person is looking at: a page that is not (backgrounded, a system screen in
        // front) must not be able to put a settings screen over whatever they are doing.
        if (!resumed) {
            Log.w("MainActivity", "ignored a request for the battery exemption: the app is not in front")
            return
        }
        startSystemScreen(batteryExemptionScreens(), forResult = false)
    }

    // ---- the one-time questions (core/PromptOnce) ----------------------------------------------------

    /** Android's own request to be exempt from battery optimisation; where a phone has none, its list of apps. */
    private fun batteryExemptionScreens() = listOf(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.fromParts("package", packageName, null)),
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
    )

    /** Android 14's switch for full-screen calls, for this app; where a phone has none, the app's notification settings. */
    private fun fullScreenScreens() = listOf(
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.fromParts("package", packageName, null)),
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
    )

    /** Opens the first of [screens] this phone has; false when it has none. [forResult]: the next question waits for the return. */
    private fun startSystemScreen(screens: List<Intent>, forResult: Boolean): Boolean {
        for (screen in screens) {
            try {
                if (forResult) askSystemScreen.launch(screen) else startActivity(screen)
                return true
            } catch (e: ActivityNotFoundException) {
                // Not on this phone: the next.
            } catch (e: SecurityException) {
                Log.w("MainActivity", "Android refused a settings screen: ${e.javaClass.simpleName}")
            }
        }
        Log.w("MainActivity", "no settings screen for that on this phone")
        return false
    }

    /** The page of the server now showing has said hello: the one-time questions may begin. */
    fun onServerPageUp() {
        serverPageUp = true
        askFirstRun()
    }

    /**
     * The things the background connection needs from the person, each asked once, the first time a
     * server's page loads, and one at a time in this order: Android's notification permission (Android
     * 13+), the battery exemption (after a short explanation of ours), full-screen calls (Android 14+, only
     * while not allowed). Each is [PromptOnce]-marked the moment it is put, so whatever the answer, or
     * none, it is never asked again; Settings › Notifications is the way back. Called again after each
     * answer, which runs the next, and from onResume for one that had to wait for the app to be on screen.
     */
    private fun askFirstRun() {
        if (asking || !serverPageUp || currentServer == null || isFinishing || isDestroyed) return
        if (!resumed) return // onResume asks again
        val kv = PrefsKeyValue(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && PromptOnce.shouldAsk(ASKED_NOTIFICATIONS, kv)) {
            PromptOnce.markAsked(ASKED_NOTIFICATIONS, kv)
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                asking = true
                askNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }

        // Without the notification permission there are no notices to keep alive for, so the questions that
        // are only about keeping the connection alive (battery, full-screen calls) wait: not asked and not
        // marked, so they are put once, when the permission has been given (Settings › Notifications).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        if (PromptOnce.shouldAsk(ASKED_BATTERY, kv)) {
            PromptOnce.markAsked(ASKED_BATTERY, kv)
            val power = getSystemService(PowerManager::class.java)
            if (power?.isIgnoringBatteryOptimizations(packageName) != true) {
                ask(R.string.ask_battery_body) { startSystemScreen(batteryExemptionScreens(), forResult = true) }
                return
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && PromptOnce.shouldAsk(ASKED_FULL_SCREEN, kv)) {
            PromptOnce.markAsked(ASKED_FULL_SCREEN, kv)
            if (getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() != true) {
                ask(R.string.ask_full_screen_body) { startSystemScreen(fullScreenScreens(), forResult = true) }
            }
        }
    }

    /**
     * A plain question with "Allow" and "Not now". Allow runs [allow], which must open a system screen
     * ([askSystemScreen] then goes on to the next question when the person is back) and say whether it
     * did; Not now, or dismissing the dialog, goes straight on.
     */
    private fun ask(@StringRes body: Int, allow: () -> Boolean) {
        asking = true
        var answered = false
        val answer = { yes: Boolean ->
            if (!answered) {
                answered = true
                questionDialog = null
                if (!(yes && allow())) {
                    asking = false
                    askFirstRun()
                }
            }
        }
        questionDialog = AlertDialog.Builder(this, R.style.Theme_Skycord_Dialog)
            .setMessage(body)
            .setPositiveButton(R.string.ask_allow) { _, _ -> answer(true) }
            .setNegativeButton(R.string.ask_not_now) { _, _ -> answer(false) }
            .setOnCancelListener { answer(false) }
            .show()
    }

    /** What a notification asked for: open a conversation, or join a call, on a saved server. */
    private class NoticeRequest(val origin: String, val join: Boolean, val value: JSONObject, val convKey: String?, val room: String? = null)

    /** The request [intent] carries, or null when it carries none (or names a server not saved). */
    private fun noticeRequest(intent: Intent): NoticeRequest? {
        // MainActivity is exported (it is the launcher), so any app can send it these extras. Only an
        // intent that came through the private alias is the app's own notification; any other starts the
        // app plainly, with the extras ignored. Both onCreate and onNewIntent come through here.
        if (!NoticeEntry.honours(intent.component?.className)) return null
        val origin = intent.getStringExtra(EXTRA_OPEN_ORIGIN)?.takeIf { store.find(it) != null } ?: return null
        val joinKind = intent.getStringExtra(EXTRA_JOIN_KIND)
        val joinId = intent.getStringExtra(EXTRA_JOIN_ID)
        if (joinKind in JOIN_KINDS && !joinId.isNullOrEmpty()) {
            val room = intent.getStringExtra(EXTRA_JOIN_ROOM)?.takeIf { it.isNotEmpty() && it.length <= MAX_ROOM }
            // An Answer for a ring that has ended (the caller hung up, or another device answered, while
            // the person was unlocking) must not start a call of its own: the app just opens.
            if (room != null && !CallRinger.isRinging(room)) return null
            return NoticeRequest(origin, join = true, JSONObject().put("kind", joinKind).put("convId", joinId), convKey = null, room = room)
        }
        val kind = intent.getStringExtra(EXTRA_OPEN_KIND)?.takeIf { it in OPEN_KINDS } ?: return null
        val id = intent.getStringExtra(EXTRA_OPEN_ID)?.takeIf { it.isNotEmpty() } ?: return null
        val value = JSONObject().put("kind", kind).put("id", id)
        intent.getStringExtra(EXTRA_OPEN_SERVER)?.takeIf { it.isNotEmpty() }?.let { value.put("serverId", it) }
        return NoticeRequest(origin, join = false, value, convKey = "$kind:$id")
    }

    private fun deliver(request: NoticeRequest) {
        // A tap cancels the notification without its delete intent, so nothing else re-arms the
        // conversation's burst (its next message must alert again, not slip in silently) or lets go of
        // the lines it held (a message in the next few seconds would bring every old line back).
        request.convKey?.let {
            NotifyHub.rearm(it)
            Notifier(this).forget(it)
        }
        // Answered: the ring is over now (its sound and screen), not when the page's join reaches the server.
        request.room?.let { NotifyService.callAnswered(this, it) }
        if (request.join) bridge.requestJoin(request.origin, request.value) else bridge.requestOpen(request.origin, request.value)
    }

    private fun launchedFromHistory(intent: Intent): Boolean =
        intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0

    private fun showUnreachable(origin: String) {
        val name = store.find(origin)?.name ?: origin
        findViewById<TextView>(R.id.unreachable_title).text = getString(R.string.unreachable_title, name)
        unreachable.visibility = View.VISIBLE
        // This screen covers the page: it is not on screen, whatever it said before, so the phone notifies.
        NotifyService.pageShown(this, null)
    }

    fun applyBarColour(css: String) {
        CssColor.parse(css)?.let { SystemBars.paint(window, root, it) }
    }

    /** The phone's browser, or another app for mailto:/tel:. False when nothing can open it. */
    private fun openExternally(uri: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    private fun androidPermissionFor(resource: String): String =
        if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA

    /** Microphone and camera: only for the current server's page, and only after Android's own prompt. */
    private fun handlePermission(request: PermissionRequest) {
        val origin = Origins.of(request.origin.toString())
        if (origin == null || origin != currentServer) { request.deny(); return }
        val wanted = request.resources.filter {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }
        if (wanted.isEmpty()) { request.deny(); return }
        val missing = wanted.map(::androidPermissionFor).distinct()
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { request.grant(wanted.toTypedArray()); return }
        // Android's prompt is already up for an earlier request: keep it and its answer, and refuse
        // this one. Denying the earlier one instead would leave both denied, since launching a second
        // prompt over the first cancels it.
        if (pendingPermission != null) { request.deny(); return }
        pendingPermission = request to wanted
        askPermissions.launch(missing.toTypedArray())
    }

    /** Only the current server's own page may open the phone's files. */
    private fun showFilePicker(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        val server = currentServer
        if (server == null || Origins.of(view.url ?: "") != server) {
            callback.onReceiveValue(null)
            return true
        }
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        val types = PickerTypes.mimeTypes(params.acceptTypes.toList()) { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
        val intent = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(types.singleOrNull() ?: "*/*")
        if (types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        return try {
            pickFiles.launch(intent)
            true
        } catch (e: ActivityNotFoundException) {
            fileCallback = null
            callback.onReceiveValue(null)
            true
        }
    }

    /**
     * What the picker returned. A third-party picker's clip item can carry no uri, and WebView
     * crashes on a null in the array, so only the real ones go through. (Not parseResult: it reads
     * only intent.data and would drop a multi-selection.)
     */
    private fun pickedUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != RESULT_OK || data == null) return null
        data.clipData?.let { clip ->
            val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            if (uris.isNotEmpty()) return uris.toTypedArray()
        }
        return data.data?.let { arrayOf(it) }
    }
}
