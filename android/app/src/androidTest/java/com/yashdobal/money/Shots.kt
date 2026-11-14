package com.yashdobal.money

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Screenshots for the review, run in the emulator by tools/android/emulator-shots.sh (GitHub Actions): the widget in
 * both sizes and its states, drawn exactly as the home screen draws it, and alerts in the notification shade.
 */
@RunWith(AndroidJUnit4::class)
class Shots {
    private val ins = InstrumentationRegistry.getInstrumentation()
    private val c: Context get() = ins.targetContext
    private val out: File by lazy { File(c.getExternalFilesDir(null), "shots").apply { mkdirs() } }

    private fun themed(night: Boolean): Context = c.createConfigurationContext(Configuration(c.resources.configuration).apply {
        uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or (if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
    })

    private fun save(name: String, v: View, wDp: Int, hDp: Int, wallpaper: Int) {
        val d = c.resources.displayMetrics.density
        val w = (wDp * d).toInt()
        val h = (hDp * d).toInt()
        val pad = (20 * d).toInt()
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w + 2 * pad, h + 2 * pad, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)
        cv.drawColor(wallpaper)
        cv.translate(pad.toFloat(), pad.toFloat())
        v.draw(cv)
        FileOutputStream(File(out, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun widget(name: String, w: JSONObject?, large: Boolean, night: Boolean) {
        ins.runOnMainSync {
            val ctx = themed(night)
            val rv = if (large) WidgetProvider.large(ctx, w) else WidgetProvider.small(ctx, w)
            val v = rv.apply(ctx, FrameLayout(ctx))
            save(name, v, if (large) 320 else 170, if (large) 168 else 64, if (night) 0xFF15161C.toInt() else 0xFFDDE3EE.toInt())
        }
    }

    @Test
    fun widgets() {
        // what the demo app itself sent while it ran in the emulator just before this test
        val fromApp = Prefs.widget(c)?.let { JSONObject(it) }
        assertTrue("the app didn't send the widget its numbers", fromApp != null && fromApp.optString("state") == "ok")
        for (night in listOf(false, true)) {
            val m = if (night) "dark" else "light"
            widget("widget-large-$m", fromApp, true, night)
            widget("widget-small-$m", fromApp, false, night)
        }
        // a healthier day, to show the layout with a figure above zero (sample numbers)
        val good = JSONObject(fromApp!!.toString())
            .put("daily", 1240).put("line", "Your spending share until payday, Wed 30 Dec").put("tone", "").put("left", 27280)
            .put("curve", JSONObject("""{"span":53,"buffer":2000,"pts":[[0,48600],[3,36150],[6,23850],[22,82450],[23,70380],[25,61200],[40,48300]],"paydays":[22,53],"low":[6,23850]}"""))
        widget("widget-large-good", good, true, false)
        widget("widget-large-hidden", JSONObject(good.toString()).put("hide", true), true, false)
        widget("widget-large-signed-out", null, true, false)
        widget("widget-small-signed-out", null, false, false)
    }

    @Test
    fun notifications() {
        Notifier.post(c, "demo-over", Notifier.CH_OVERDUE, "Lotus Shopper bill is overdue", "₹4,210 was due 5 Dec. Pay it today to avoid the late fee.", Site.at("#/cards"))
        Notifier.post(c, "demo-bill", Notifier.CH_ALERTS, "Harbour Miles bill due in 3 days", "₹18,450 left to pay, due 11 Dec.", Site.at("#/cards"))
        Notifier.post(c, "demo-digest", Notifier.CH_ALERTS, "₹1,240 a day safe to spend", "Spent today ₹620. Where you stand ₹31,780. Coming up: SIP ₹8,510 tomorrow.", Site.at("#/today"))
    }
}
