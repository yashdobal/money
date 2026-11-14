package com.yashdobal.money

import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/**
 * window.AndroidBridge: what the web page (app/ui.js, app/money-data.js) can ask of the phone. Calls arrive on a
 * background thread; anything that touches the screen goes to the main thread. Only pages from the site itself may
 * use it (trusted is false while anything else is showing).
 */
class Bridge(private val act: MainActivity) {
    @Volatile var trusted = false
    private val ctx = act.applicationContext
    private fun ui(block: () -> Unit) = act.runOnUiThread { if (!act.isDestroyed) block() }
    private fun <T> onUi(fallback: T, block: () -> T): T = try {
        val task = FutureTask(Callable { block() })
        act.runOnUiThread(task)
        task.get(5, TimeUnit.SECONDS)
    } catch (e: Exception) { fallback }

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

    /* the Supabase sign-in, kept by the app (supabase-js uses these as its storage) */
    @JavascriptInterface fun sessionGet(key: String): String? = if (trusted) Prefs.session(ctx).getString(key, null) else null
    @JavascriptInterface fun sessionSet(key: String, value: String?) { if (trusted) Prefs.session(ctx).edit().putString(key, value).apply() }
    @JavascriptInterface fun sessionDel(key: String) { if (trusted) Prefs.session(ctx).edit().remove(key).apply() }

    /* feel and look */
    @JavascriptInterface fun haptic(kind: String) { ui { act.haptic(kind) } }
    @JavascriptInterface fun setBars(dark: Boolean) { ui { act.setBars(dark) } }
    @JavascriptInterface fun setBarColors(top: String, bottom: String) { ui { act.setBarColors(top, bottom) } }
    /** The phone's Material You colours as JSON ({} before Android 12), for the "System" colour theme. */
    @JavascriptInterface fun systemColors(): String = SystemColors.json(ctx)

    /* the fingerprint lock */
    @JavascriptInterface fun lockInfo(): String = JSONObject()
        .put("available", act.lock.available())
        .put("enabled", act.lock.enabled())
        .put("after", Prefs.lockAfter(ctx))
        .put("hideRecents", Prefs.hideRecents(ctx))
        .toString()

    /** Asks for the fingerprint first; the page hears back through a "native" event {type: "lock", ok, enabled}. */
    @JavascriptInterface fun setLock(on: Boolean) {
        if (!trusted) return
        ui {
            act.lock.requestToggle(on) { ok, message ->
                act.emit(JSONObject().put("type", "lock").put("ok", ok).put("enabled", act.lock.enabled()).apply { if (message != null) put("message", message) })
            }
        }
    }
    @JavascriptInterface fun setLockAfter(seconds: Int) { if (trusted && seconds in setOf(0, 60, 300)) Prefs.setLockAfter(ctx, seconds) }
    @JavascriptInterface fun setHideRecents(on: Boolean) { if (trusted) { Prefs.setHideRecents(ctx, on); ui { act.applyHideRecents() } } }
    @JavascriptInterface fun openLockSettings() { ui { act.openSecuritySettings() } }

    /* alerts */
    @JavascriptInterface fun notifInfo(): String = Notifier.info(act).toString()
    @JavascriptInterface fun testNotification(): String = if (!trusted) "" else onUi("") { Notifier.test(act) }
    @JavascriptInterface fun openNotificationSettings() { ui { Notifier.openAppSettings(act) } }

    /* sign-in links */
    @JavascriptInterface fun openLinkSettings() { ui { act.openLinkSettings() } }
    @JavascriptInterface fun linksVerified(): String = act.linksState()
    @JavascriptInterface fun openEmailApp() { ui { act.openEmailApp() } }

    /* the CSV export, through the share sheet */
    @JavascriptInterface fun shareFile(name: String, text: String, mime: String) { if (trusted) ui { act.shareText(name, text, mime) } }

    /* the widget and background work */
    @JavascriptInterface fun pushWidget(json: String) { if (trusted) WidgetStore.fromApp(ctx, json) }
    @JavascriptInterface fun clearWidget() { WidgetStore.clear(ctx) }
    @JavascriptInterface fun signedOut() { if (trusted) Account.signedOut(ctx) }
    @JavascriptInterface fun hasDeviceKey(): Boolean = Prefs.deviceKey(ctx) != null
    @JavascriptInterface fun setDeviceKey(key: String) {
        if (!trusted || !Regex("^[A-Za-z0-9_-]{40,60}$").matches(key)) return
        Prefs.setDeviceKey(ctx, key)
        Alerts.refreshNow(ctx)                   // the widget gets the server's numbers straight away
    }
}
