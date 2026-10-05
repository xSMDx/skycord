package xyz.skycord.android

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.TextView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import xyz.skycord.android.core.CssColor
import xyz.skycord.android.core.Nav
import xyz.skycord.android.core.NavigationPolicy
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.ServerStore

class MainActivity : AppCompatActivity() {
    companion object {
        const val LAUNCHER_ORIGIN = "https://appassets.androidplatform.net"
        const val LAUNCHER_URL = "$LAUNCHER_ORIGIN/assets/launcher/index.html"
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

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val (request, resources) = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val granted = resources.filter { ContextCompat.checkSelfPermission(this, androidPermissionFor(it)) == PackageManager.PERMISSION_GRANTED }
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
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

        val last = store.last()
        if (last != null) openServer(last) else showLauncher()
        updates.checkOnLaunch()
    }

    override fun onPause() {
        super.onPause()
        // Keep each server's sign-in if the process is killed while we are in the background.
        // `web` is unset on the old-WebView screen, where there may be no WebView provider at all.
        if (::web.isInitialized) CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        // onCreate returns early on the old-WebView screen, before updates exists.
        if (::updates.isInitialized) updates.close()
        super.onDestroy()
    }

    private fun onCreateBridge() {
        bridge = BridgeHost(this)
        bridge.refresh()
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

            override fun onPageFinished(view: WebView, url: String) {
                // WebView also calls this after a failed load (for its error page), hence loadFailed.
                if (currentServer != null && Origins.of(url) == currentServer && !loadFailed) serverLoaded = true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = handlePermission(request)

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingPermission?.first == request) pendingPermission = null
            }
        }
    }

    fun openServer(origin: String) {
        unreachable.visibility = View.GONE
        serverLoaded = false
        loadFailed = false
        currentServer = origin
        store.setLast(origin)
        onServerChanged()
        web.loadUrl("$origin/")
    }

    fun showLauncher() {
        unreachable.visibility = View.GONE
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
        pendingPermission?.first?.deny()
        pendingPermission = request to wanted
        askPermissions.launch(missing.toTypedArray())
    }
}
