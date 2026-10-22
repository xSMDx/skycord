package xyz.skycord.android

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import xyz.skycord.android.core.BackAction
import xyz.skycord.android.core.BackGate
import xyz.skycord.android.core.CssColor
import xyz.skycord.android.core.Nav
import xyz.skycord.android.core.NavigationPolicy
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.PickerTypes
import xyz.skycord.android.core.ServerStore

class MainActivity : AppCompatActivity() {
    companion object {
        const val LAUNCHER_ORIGIN = "https://appassets.androidplatform.net"
        const val LAUNCHER_URL = "$LAUNCHER_ORIGIN/assets/launcher/index.html"
        /** The launcher shortcut "Choose a server" (res/xml/shortcuts.xml) sends this. */
        const val ACTION_CHOOSE_SERVER = "xyz.skycord.android.action.CHOOSE_SERVER"
        private const val WEBVIEW_PACKAGE = "com.google.android.webview"
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

        // The shortcut asks for the server list, not the server the app last had open.
        val last = store.last()
        if (intent?.action == ACTION_CHOOSE_SERVER || last == null) showLauncher() else openServer(last)
        updates.checkOnLaunch()
    }

    // singleTask: a running app gets the launcher shortcut here, not in onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // `web` is unset on the old-WebView screen, which has no server list to show. Already on the
        // launcher (currentServer is null): leave it alone, so a half-typed address isn't wiped.
        if (intent.action == ACTION_CHOOSE_SERVER && ::web.isInitialized && currentServer != null) showLauncher()
    }

    override fun onResume() {
        super.onResume()
        // The launch check has just set the time, so the first onResume after onCreate does not repeat it.
        if (::updates.isInitialized) updates.checkIfStale()
    }

    override fun onPause() {
        super.onPause()
        // Keep each server's sign-in if the process is killed while we are in the background.
        // `web` is unset on the old-WebView screen, where there may be no WebView provider at all.
        if (::web.isInitialized) CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
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
        if (::bridge.isInitialized) bridge.refresh()
    }

    private fun showUnreachable(origin: String) {
        val name = store.find(origin)?.name ?: origin
        findViewById<TextView>(R.id.unreachable_title).text = getString(R.string.unreachable_title, name)
        unreachable.visibility = View.VISIBLE
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
