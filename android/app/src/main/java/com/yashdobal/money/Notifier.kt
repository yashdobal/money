package com.yashdobal.money

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Alerts on the phone. Two channels: normal (bills due, EMIs, salary, a quiet collector, the 9 PM summary) and
 * overdue. Nothing between 10 PM and 8 AM. Each alert has a key and shows once.
 */
object Notifier {
    const val CH_ALERTS = "alerts"
    const val CH_OVERDUE = "overdue"
    private const val HOUR = 3_600_000L

    fun createChannels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_ALERTS, c.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = c.getString(R.string.channel_alerts_desc) })
        nm.createNotificationChannel(NotificationChannel(CH_OVERDUE, c.getString(R.string.channel_overdue), NotificationManager.IMPORTANCE_HIGH)
            .apply { description = c.getString(R.string.channel_overdue_desc) })
    }

    fun permitted(c: Context): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun muted(c: Context): Boolean =
        NotificationManagerCompat.from(c).getNotificationChannel(CH_ALERTS)?.importance == NotificationManager.IMPORTANCE_NONE

    /** For Settings in the page: permission granted / ask / blocked, notifications on, alerts channel muted. */
    fun info(act: Activity): JSONObject {
        val perm = when {
            permitted(act) -> "granted"
            Build.VERSION.SDK_INT >= 33 && Prefs.askedNotif(act) &&
                !ActivityCompat.shouldShowRequestPermissionRationale(act, Manifest.permission.POST_NOTIFICATIONS) -> "blocked"
            else -> "ask"
        }
        return JSONObject().put("permission", perm).put("enabled", NotificationManagerCompat.from(act).areNotificationsEnabled()).put("muted", muted(act))
    }

    /**
     * The test alert, shown straight from the phone (never through the hourly job, which waits out quiet hours).
     * If it can't show, says why and opens the right Android setting. Android asks for the permission at most twice;
     * after that it won't ask again, so Settings opens instead.
     *   "shown" · "asking" (the answer arrives later) · "settings:permission" · "settings:off" · "settings:channel"
     */
    fun test(act: MainActivity): String {
        if (!permitted(act)) {
            val canAsk = !Prefs.askedNotif(act) || ActivityCompat.shouldShowRequestPermissionRationale(act, Manifest.permission.POST_NOTIFICATIONS)
            if (canAsk) {
                Prefs.setAskedNotif(act)
                act.askNotificationPermission()
                return "asking"
            }
            openAppSettings(act)
            return "settings:permission"
        }
        if (!NotificationManagerCompat.from(act).areNotificationsEnabled()) { openAppSettings(act); return "settings:off" }
        if (muted(act)) { openChannelSettings(act, CH_ALERTS); return "settings:channel" }
        return showTest(act)
    }

    fun showTest(c: Context): String {
        post(c, "test", CH_ALERTS, "Test from Money", "Alerts work. Bills, EMIs and your salary will show up like this.", Site.at("#/today"))
        return "shown"
    }

    fun openAppSettings(c: Context) {
        val i = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName)
        start(c, i, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.packageName)))
    }

    /** The app's own page in Android's settings (Permissions → SMS). */
    fun openAppDetails(c: Context) {
        val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.packageName))
        start(c, i, Intent(Settings.ACTION_SETTINGS))
    }

    private fun openChannelSettings(c: Context, channel: String) {
        val i = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, channel)
        start(c, i, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName))
    }

    private fun start(c: Context, first: Intent, fallback: Intent) {
        if (c !is Activity) { first.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        try { c.startActivity(first) } catch (e: Exception) { try { c.startActivity(fallback) } catch (e2: Exception) {} }
    }

    @SuppressLint("MissingPermission")
    fun post(c: Context, key: String, channel: String, title: String, body: String, url: String) {
        if (!permitted(c)) return
        val open = PendingIntent.getActivity(
            c, key.hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(ContextCompat.getColor(c, R.color.icon_bg))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (channel == CH_OVERDUE) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            // on the lock screen: what kind of alert it is, never the amounts
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(ContextCompat.getColor(c, R.color.icon_bg))
                .setContentTitle(c.getString(R.string.app_name))
                .setContentText(publicText(key))
                .build())
            .build()
        NotificationManagerCompat.from(c).notify(key.hashCode(), n)
    }

    private fun publicText(key: String): String = when {
        key.startsWith("bill-over") || key.endsWith("-over") -> "A card bill is overdue"
        key.startsWith("bill") || key.endsWith("-bill") -> "A card bill is due soon"
        key.startsWith("digest") || key.endsWith("-digest") -> "Your 9 PM summary"
        key.startsWith("salary") -> "Your salary landed"
        key.startsWith("emi") -> "An EMI is due tomorrow"
        key.startsWith("quiet") -> "The collector needs a look"
        else -> "New alert"
    }

    /** Alerts from the server (device function). Shows the new ones; holds them during quiet hours; drops stale ones. */
    @Synchronized
    fun showAlerts(c: Context, alerts: JSONArray, now: Long = System.currentTimeMillis(),
                   hour: Int = Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.HOUR_OF_DAY)) {
        val quiet = hour < 8 || hour >= 22
        val canShow = !quiet && permitted(c) && NotificationManagerCompat.from(c).areNotificationsEnabled()
        val shown = Prefs.shown(c)
        var changed = false
        for (i in 0 until alerts.length()) {
            val a = alerts.optJSONObject(i) ?: continue
            val key = a.optString("key")
            if (key.isEmpty() || shown.has(key)) continue
            val age = now - a.optLong("at", now)
            if (age > (if (key.startsWith("digest|")) 3 else 12) * HOUR) { shown.put(key, now); changed = true; continue }   // too old to be news
            if (!canShow) continue                                                                                          // held for later
            val channel = if (a.optString("channel") == "overdue") CH_OVERDUE else CH_ALERTS
            post(c, key, channel, a.optString("title"), a.optString("body"), Site.at(a.optString("url", "#/today")))
            shown.put(key, now)
            changed = true
        }
        val keys = shown.keys().asSequence().toList()
        for (k in keys) if (now - shown.optLong(k) > 10 * 24 * HOUR) { shown.remove(k); changed = true }
        if (changed) Prefs.setShown(c, shown)
    }
}
