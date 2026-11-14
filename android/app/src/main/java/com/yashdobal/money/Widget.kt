package com.yashdobal.money

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The widget's numbers. The page sends them whenever its data loads (AndroidBridge.pushWidget); the hourly job
 * merges in the server's (supabase/functions/device, the same engine) without wiping the curve. Signing out clears them.
 */
object WidgetStore {
    fun read(c: Context): JSONObject? = Prefs.widget(c)?.let { try { JSONObject(it) } catch (e: Exception) { null } }

    @Synchronized
    fun fromApp(c: Context, json: String) {
        val w = try { JSONObject(json) } catch (e: Exception) { return }
        w.put("src", "app")
        Prefs.setWidget(c, w.toString())
        WidgetProvider.updateAll(c)
    }

    /** The server's numbers, asked for with this device key. False (and nothing changes) if you've signed out since. */
    @Synchronized
    fun fromServer(c: Context, server: JSONObject?, key: String): Boolean {
        if (Prefs.deviceKey(c) != key) return false
        if (server == null || !server.has("state")) return true
        val old = read(c)
        if (old != null && old.optLong("at") > server.optLong("at")) return true  // the app's are newer
        if (old != null) {
            if (!server.has("curve") && old.has("curve") && server.optString("state") == "ok") server.put("curve", old.get("curve"))
            if (old.has("hide")) server.put("hide", old.optBoolean("hide"))     // your "hide amounts" choice in the app
        }
        server.put("src", "server")
        Prefs.setWidget(c, server.toString())
        WidgetProvider.updateAll(c)
        return true
    }

    @Synchronized
    fun clear(c: Context) {
        Prefs.setWidget(c, null)
        WidgetProvider.updateAll(c)
    }
}

class WidgetProvider : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(c, m, it) }
    }

    override fun onAppWidgetOptionsChanged(c: Context, m: AppWidgetManager, id: Int, options: Bundle) {
        render(c, m, id)
    }

    override fun onReceive(c: Context, intent: Intent) {
        super.onReceive(c, intent)
        if (intent.action == ACTION_REFRESH) {
            refreshingSince = System.currentTimeMillis()
            updateAll(c)
            Alerts.refreshNow(c)
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.yashdobal.money.WIDGET_REFRESH"
        /** when ↻ was tapped; "Updating…" shows until the job answers, or for 2 minutes at most */
        @Volatile var refreshingSince = 0L
        private val refreshing get() = System.currentTimeMillis() - refreshingSince < 120_000

        fun updateAll(c: Context) {
            val m = AppWidgetManager.getInstance(c) ?: return
            m.getAppWidgetIds(ComponentName(c, WidgetProvider::class.java)).forEach { render(c, m, it) }
        }

        /** Two sizes, chosen from the widget's width: large from 250 dp wide, small below. */
        fun render(c: Context, m: AppWidgetManager, id: Int) {
            val w = WidgetStore.read(c)
            val views = if (Build.VERSION.SDK_INT >= 31) {
                RemoteViews(mapOf(SizeF(100f, 40f) to small(c, w), SizeF(250f, 100f) to large(c, w)))
            } else {
                val minW = m.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
                if (minW >= 250) large(c, w) else small(c, w)
            }
            m.updateAppWidget(id, views)
        }

        private val inr: NumberFormat = NumberFormat.getIntegerInstance(Locale("en", "IN"))
        fun rupees(v: Long, hide: Boolean): String = if (hide) "₹••••" else (if (v < 0) "−" else "") + "₹" + inr.format(kotlin.math.abs(v))

        private fun open(c: Context, route: String, code: Int): PendingIntent = PendingIntent.getActivity(
            c, code, Intent(Intent.ACTION_VIEW, Uri.parse(Site.at(route)), c, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        private class Texts(val fig: String, val per: String, val line: String, val alert: Boolean, val ok: Boolean)

        private fun texts(c: Context, w: JSONObject?): Texts {
            val hide = w?.optBoolean("hide") == true
            return when (w?.optString("state")) {
                "ok" -> Texts(rupees(w.optLong("left"), hide), c.getString(R.string.widget_until_payday), w.optString("line"), w.optString("tone") == "alert", true)
                "noinc" -> Texts("—", "", c.getString(R.string.widget_noinc), false, false)
                "nobal" -> Texts("—", "", c.getString(R.string.widget_nobal), false, false)
                else -> Texts("—", "", c.getString(R.string.widget_open), false, false)
            }
        }

        /** "Updated 9:41", or the day the figures are from if it isn't today (tap ↻ or open the app). */
        private fun label(c: Context, w: JSONObject?): String {
            if (refreshing) return c.getString(R.string.widget_updating)
            if (w == null || !w.has("at")) return c.getString(R.string.widget_label)
            val at = Date(w.optLong("at"))
            val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val day = w.optString("day")
            return if (day == today) c.getString(R.string.widget_label) + " · " + SimpleDateFormat("h:mm a", Locale("en", "IN")).format(at).lowercase()
            else "From " + SimpleDateFormat("d MMM", Locale("en", "IN")).format(at) + " · tap ↻"
        }

        fun large(c: Context, w: JSONObject?): RemoteViews {
            val v = RemoteViews(c.packageName, R.layout.widget_large)
            val t = texts(c, w)
            v.setTextViewText(R.id.w_label, label(c, w))
            v.setTextViewText(R.id.w_fig, t.fig)
            v.setTextViewText(R.id.w_per, t.per)
            v.setTextViewText(R.id.w_line, t.line)
            v.setTextColor(R.id.w_line, ContextCompat.getColor(c, if (t.alert) R.color.hero_alert else R.color.hero_ink2))
            val hide = w?.optBoolean("hide") == true
            if (t.ok && w != null) {
                v.setTextViewText(R.id.w_left, rupees(w.optLong("daily"), hide) + " " + c.getString(R.string.widget_a_day))
                v.setTextViewText(R.id.w_bill, billText(w.optJSONObject("bill"), hide))
                v.setViewVisibility(R.id.w_left, View.VISIBLE)
                v.setViewVisibility(R.id.w_bill, if (w.has("bill") && !w.isNull("bill")) View.VISIBLE else View.GONE)
                val curve = w.optJSONObject("curve")
                if (curve != null && !hide) {
                    v.setImageViewBitmap(R.id.w_curve, Curve.draw(curve))
                    v.setViewVisibility(R.id.w_curve, View.VISIBLE)
                } else v.setViewVisibility(R.id.w_curve, View.INVISIBLE)
            } else {
                v.setViewVisibility(R.id.w_left, View.GONE)
                v.setViewVisibility(R.id.w_bill, View.GONE)
                v.setViewVisibility(R.id.w_curve, View.INVISIBLE)
            }
            v.setOnClickPendingIntent(R.id.w_root, open(c, "#/today", 10))
            v.setOnClickPendingIntent(R.id.w_add, open(c, "#/today?sheet=add", 11))
            v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(
                c, 12, Intent(c, WidgetProvider::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ))
            return v
        }

        fun small(c: Context, w: JSONObject?): RemoteViews {
            val v = RemoteViews(c.packageName, R.layout.widget_small)
            val t = texts(c, w)
            v.setTextViewText(R.id.w_fig, t.fig)
            v.setTextViewText(R.id.w_per, if (t.ok) t.per else if (w == null) c.getString(R.string.widget_open_short) else t.line)
            v.setOnClickPendingIntent(R.id.w_root, open(c, "#/today", 10))
            v.setOnClickPendingIntent(R.id.w_add, open(c, "#/today?sheet=add", 11))
            return v
        }

        private fun billText(b: JSONObject?, hide: Boolean): String {
            if (b == null) return ""
            val amt = rupees(b.optLong("amt"), hide)
            val over = b.optInt("overdue")
            val n = b.optInt("n")
            val whenText = when {
                over > 0 -> "$over " + (if (over == 1) "day" else "days") + " overdue"
                n == 0 -> "due today"
                n == 1 -> "due tomorrow"
                else -> try {
                    "due " + SimpleDateFormat("d MMM", Locale("en", "IN")).format(SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(b.optString("due"))!!)
                } catch (e: Exception) { "due in $n days" }
            }
            return "Next: " + b.optString("title") + " " + amt + " · " + whenText
        }
    }
}

/** The balance until the salary after next, as a step line (it only moves on the days money moves). */
object Curve {
    fun draw(curve: JSONObject, wPx: Int = 600, hPx: Int = 100): Bitmap {
        val bmp = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)
        val arr = curve.optJSONArray("pts") ?: return bmp
        val pts = (0 until arr.length()).mapNotNull { i -> arr.optJSONArray(i)?.let { it.optInt(0) to it.optDouble(1) } }
        if (pts.isEmpty()) return bmp
        val span = curve.optInt("span", 30).coerceAtLeast(1)
        val buffer = curve.optDouble("buffer", 0.0)
        val lo = minOf(pts.minOf { it.second }, buffer, 0.0)
        val hi = maxOf(pts.maxOf { it.second }, buffer + 1.0)
        val pad = 6f
        fun x(d: Int) = pad + (wPx - 2 * pad) * d.coerceIn(0, span) / span
        fun y(v: Double) = (pad + (hPx - 2 * pad) * (1 - (v - lo) / (hi - lo))).toFloat()

        val line = Path().apply {
            moveTo(x(pts[0].first), y(pts[0].second))
            for (i in 1 until pts.size) {
                lineTo(x(pts[i].first), y(pts[i - 1].second))
                lineTo(x(pts[i].first), y(pts[i].second))
            }
            lineTo(x(span), y(pts.last().second))
        }
        val fill = Path(line).apply { lineTo(x(span), hPx.toFloat()); lineTo(x(pts[0].first), hPx.toFloat()); close() }
        cv.drawPath(fill, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x16FFFFFF; style = Paint.Style.FILL })

        val dash = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40FFFFFF; strokeWidth = 1.5f; pathEffect = DashPathEffect(floatArrayOf(7f, 6f), 0f) }
        cv.drawLine(pad, y(buffer), wPx - pad, y(buffer), dash)
        curve.optJSONArray("paydays")?.let { p ->
            val tick = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x55FFFFFF; strokeWidth = 2f }
            for (i in 0 until p.length()) { val px = x(p.optInt(i)); cv.drawLine(px, hPx - pad - 10f, px, hPx - pad, tick) }
        }

        // above the buffer in the app's accent, below it in red
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3.5f; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND }
        val split = y(buffer)
        cv.save(); cv.clipRect(0f, 0f, wPx.toFloat(), split); stroke.color = 0xFFEDEDEB.toInt(); cv.drawPath(line, stroke); cv.restore()
        cv.save(); cv.clipRect(0f, split, wPx.toFloat(), hPx.toFloat()); stroke.color = 0xFFF48C7E.toInt(); cv.drawPath(line, stroke); cv.restore()

        curve.optJSONArray("low")?.let { l ->
            val bal = l.optDouble(1)
            val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (bal < buffer) 0xFFF48C7E.toInt() else 0xFFFFFFFF.toInt() }
            cv.drawCircle(x(l.optInt(0)), y(bal), 5f, dot)
        }
        return bmp
    }
}
