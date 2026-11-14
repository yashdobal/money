package com.yashdobal.money

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.verify.domain.DomainVerificationManager
import android.content.pm.verify.domain.DomainVerificationUserState
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

/**
 * The app: the web app from the APK in a WebView (AppCompatActivity is a FragmentActivity, which BiometricPrompt
 * needs), the fingerprint lock over it, and window.AndroidBridge for what only the phone can do.
 */
class MainActivity : AppCompatActivity() {
    lateinit var web: WebView
        private set
    lateinit var lock: LockGate
        private set
    private lateinit var bridge: Bridge
    private lateinit var root: FrameLayout
    private lateinit var topBar: View
    private lateinit var bottomBar: View
    private lateinit var server: AssetServer
    private var pageReady = false

    private val askNotif = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        emit(JSONObject().put("type", "notif").put("status", if (granted) Notifier.showTest(this) else "denied"))
    }

    fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        topBar = findViewById(R.id.topBar)
        bottomBar = findViewById(R.id.bottomBar)
        val overlay = findViewById<View>(R.id.lock)
        lock = LockGate(this, overlay, findViewById(R.id.lockText), findViewById(R.id.lockBtn)) { locked ->
            web.importantForAccessibility = if (locked) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        }
        applyHideRecents()
        setBars(isNight())
        fitInsets(overlay)
        server = AssetServer(applicationContext)          // the app-wide service-worker client keeps it: no screen inside
        setUpWebView()

        // a cold start locks; so does coming back after Android closed the app in the background, or a dark-mode
        // switch while it was locked
        val restored = saved != null && processAlive
        lock.onCreate(coldStart = !restored || saved!!.getBoolean("locked"))
        processAlive = true

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = back()
        })
        val start = (if (saved != null) saved.getString("url")?.takeIf { Site.isOurs(Uri.parse(it)) } else null)
            ?: urlFrom(intent) ?: "${Site.ORIGIN}/"
        web.loadUrl(start)
    }

    private fun isNight() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    /** The page sits between the status bar and the navigation bar (or the keyboard); two strips fill in behind the bars. */
    private fun fitInsets(overlay: View) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, wi ->
            val bars = wi.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = wi.getInsets(WindowInsetsCompat.Type.ime())
            topBar.updateLayoutParams<FrameLayout.LayoutParams> { height = bars.top }
            bottomBar.updateLayoutParams<FrameLayout.LayoutParams> { height = bars.bottom }
            web.updateLayoutParams<FrameLayout.LayoutParams> { setMargins(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom)) }
            overlay.setPadding(bars.left + dp(32), bars.top, bars.right + dp(32), bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE          // the files come from the APK; nothing stale
            textZoom = 100                                 // the phone's font size setting otherwise breaks the layout
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            userAgentString = "$userAgentString MoneyApp/${BuildConfig.VERSION_NAME}"
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.settings, false)   // the page has its own dark theme
        }
        web.overScrollMode = View.OVER_SCROLL_NEVER        // no glow at the ends
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.ground))
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        bridge = Bridge(this)
        web.addJavascriptInterface(bridge, "AndroidBridge")
        web.webViewClient = Client()
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("Money", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        // a service worker from an older version must not serve old screens: its requests get the APK's files too
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            val sw = ServiceWorkerControllerCompat.getInstance()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CACHE_MODE)) sw.serviceWorkerWebSettings.cacheMode = WebSettings.LOAD_NO_CACHE
            sw.setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = server.serve(request.url, request.method)
            })
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // decided before the page's own scripts run, so the sign-in can be read on the very first try
            if (request.isForMainFrame) bridge.trusted = Site.isOurs(request.url)
            return server.serve(request.url, request.method)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (Site.isOurs(request.url)) return false
            openOutside(request.url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            bridge.trusted = Site.isOurs(Uri.parse(url))
            pageReady = false
        }

        override fun onPageFinished(view: WebView, url: String) {
            pageReady = true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recreate()
            return true
        }
    }

    private fun urlFrom(i: Intent?): String? {
        val d = i?.data ?: return null
        return if (i.action == Intent.ACTION_VIEW && Site.isOurs(d)) d.toString() else null
    }

    /** A sign-in link, a notification, the widget or a shortcut while the app is already open. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = urlFrom(intent) ?: return
        val u = Uri.parse(url)
        val frag = u.fragment ?: ""
        if (frag.contains("access_token=")) {
            // a sign-in link: only the part after # differs from the open page, which WebView treats as a jump within
            // the page, and the sign-in is read only when a page starts; so pass it as ?h=, which reloads the page
            web.loadUrl("${Site.ORIGIN}/?h=" + Uri.encode(frag))
        } else if (u.getQueryParameter("h") == null && pageReady && (frag.isEmpty() || frag.startsWith("/"))) {
            val route = "#" + frag.ifEmpty { "/today" }
            web.evaluateJavascript("window.UI&&UI.open?UI.open(${JSONObject.quote(route)}):location.replace(${JSONObject.quote(url)})", null)
        } else {
            web.loadUrl(url)
        }
    }

    /** Back closes a sheet, leaves Settings, goes to Today; on Today the app goes to the background. */
    private fun back() {
        if (lock.locked) { moveTaskToBack(true); return }
        web.evaluateJavascript("(function(){try{return !!(window.UI&&UI.back&&UI.back());}catch(e){return false;}})()") { r ->
            if (r != "true") moveTaskToBack(true)
        }
    }

    override fun onStart() { super.onStart(); lock.onStart() }
    override fun onResume() { super.onResume(); lock.onResume() }
    override fun onStop() { super.onStop(); lock.onStop(isChangingConfigurations) }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        web.url?.let { out.putString("url", it) }
        out.putBoolean("locked", lock.locked)
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    /* ---------------- what the bridge asks for ---------------- */

    fun emit(detail: JSONObject) {
        if (!isDestroyed) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('native',{detail:$detail}))", null)
    }

    fun applyHideRecents() {
        if (Prefs.hideRecents(this)) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    /** The status and navigation bars follow the page's light or dark theme. */
    fun setBars(dark: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        val bg = if (dark) 0xFF0C0C0C.toInt() else 0xFFF6F6F4.toInt()
        topBar.setBackgroundColor(bg)
        bottomBar.setBackgroundColor(bg)
        root.setBackgroundColor(bg)
    }

    fun setBarColors(top: String, bottom: String) {
        cssColor(top)?.let { topBar.setBackgroundColor(it) }
        cssColor(bottom)?.let { bottomBar.setBackgroundColor(it) }
    }

    private fun cssColor(s: String): Int? {
        val t = s.trim()
        if (t.startsWith("#")) return try { Color.parseColor(t) } catch (e: Exception) { null }
        val m = Regex("""rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)""").find(t) ?: return null
        val (r, g, b) = m.destructured
        val a = m.groupValues[4].toFloatOrNull() ?: 1f
        if (a < 0.99f) return null                  // see-through: leave the strip as it is
        return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }

    fun haptic(kind: String) {
        val c = when (kind) {
            "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            "error" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        web.performHapticFeedback(c)
    }

    private fun tryStart(vararg intents: Intent): Boolean {
        for (i in intents) {
            try { startActivity(i); return true } catch (e: ActivityNotFoundException) { } catch (e: RuntimeException) { }
        }
        return false
    }

    /** A link to anywhere else opens outside the app. Never files, never with the app's file permissions. */
    private fun openOutside(u: Uri) {
        if (u.scheme == "file" || u.scheme == "content" || u.scheme == "javascript") return
        val i = if (u.scheme == "intent") {
            try {
                Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).apply {
                    selector = null
                    component = null
                    flags = flags and GRANTS.inv()
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
            } catch (e: Exception) { return }
        } else Intent(Intent.ACTION_VIEW, u)
        val s = i.data?.scheme
        if (s == "file" || s == "content") return
        tryStart(i)
    }

    fun openSecuritySettings() {
        tryStart(Intent(Settings.ACTION_SECURITY_SETTINGS), Intent(Settings.ACTION_SETTINGS))
    }

    /** Android's "Open supported links" for this app, so sign-in links open here instead of the browser. */
    fun openLinkSettings() {
        val pkg = Uri.parse("package:$packageName")
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
        if (Build.VERSION.SDK_INT >= 31) tryStart(Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, pkg), details) else tryStart(details)
    }

    /** verified (Android checked assetlinks.json) · selected (you chose this app) · none · unknown (Android 11 or older) */
    fun linksState(): String {
        if (Build.VERSION.SDK_INT < 31) return "unknown"
        return try {
            val s = getSystemService(DomainVerificationManager::class.java)?.getDomainVerificationUserState(packageName) ?: return "unknown"
            when (s.hostToStateMap[Site.HOST]) {
                DomainVerificationUserState.DOMAIN_STATE_VERIFIED -> "verified"
                DomainVerificationUserState.DOMAIN_STATE_SELECTED -> "selected"
                else -> "none"
            }
        } catch (e: Exception) { "unknown" }
    }

    fun openEmailApp() {
        val chooser = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val gmail = packageManager.getLaunchIntentForPackage("com.google.android.gm")
        val ok = if (gmail != null) tryStart(chooser, gmail) else tryStart(chooser)
        if (!ok) Toast.makeText(this, R.string.no_email_app, Toast.LENGTH_SHORT).show()
    }

    /** The CSV export: written to the app's cache and handed to the share sheet (Drive, Gmail, Sheets…). */
    fun shareText(name: String, text: String, mime: String) {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "money.csv" }
        val dir = File(cacheDir, "share").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, safe)
        f.writeText(text, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, safe)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(safe, uri)
        tryStart(Intent.createChooser(send, safe))
    }

    companion object {
        private const val GRANTS = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION

        /** false in a fresh process: an activity restored after Android closed the app counts as a cold start */
        @Volatile private var processAlive = false
    }
}
