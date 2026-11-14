package com.yashdobal.money

import android.app.NotificationManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/**
 * Runs on the build machine (no phone or emulator): the alert rules, the widget's numbers, and pictures of the widget
 * and the lock screen drawn by Android's own drawing code. Pictures go to android/app/build/shots.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi", application = android.app.Application::class)
class AppTest {
    private val c: Context get() = ApplicationProvider.getApplicationContext()
    private val out = File("build/shots").apply { mkdirs() }

    private val sample = JSONObject("""{"v":1,"at":${System.currentTimeMillis()},"day":"${java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())}","state":"ok","daily":1240,
        "line":"Your spending share until payday, Wed 30 Dec","tone":"","left":27280,"leftDays":22,"payday":"2026-12-30",
        "bill":{"title":"Harbour Miles bill","amt":18450,"due":"2026-12-11","n":3,"overdue":0},
        "curve":{"span":53,"buffer":2000,"pts":[[0,48600],[3,36150],[6,23850],[22,82450],[23,70380],[25,61200],[40,48300]],"paydays":[22,53],"low":[6,23850]}}""")
    private val short = JSONObject(sample.toString()).put("daily", 0).put("left", 0).put("tone", "alert").put("line", "₹32,492 short on Fri 18 Dec")
        .put("curve", JSONObject("""{"span":53,"buffer":2000,"pts":[[0,10738],[10,-30492],[22,18018],[23,5948],[24,-8052],[25,-14717],[40,-18985]],"paydays":[22,53],"low":[10,-30492]}"""))

    @Before fun clean() {
        Prefs.clearSignedIn(c)
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun save(name: String, v: View, wDp: Int, hDp: Int, bg: Int) {
        val d = c.resources.displayMetrics.density
        val w = (wDp * d).toInt(); val h = (hDp * d).toInt(); val pad = (20 * d).toInt()
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w + 2 * pad, h + 2 * pad, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp); cv.drawColor(bg); cv.translate(pad.toFloat(), pad.toFloat()); v.draw(cv)
        FileOutputStream(File(out, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun widget(name: String, w: JSONObject?, large: Boolean, wallpaper: Int = 0xFFDDE3EE.toInt()) {
        val rv = if (large) WidgetProvider.large(c, w) else WidgetProvider.small(c, w)
        save(name, rv.apply(c, FrameLayout(c)), if (large) 320 else 170, if (large) 168 else 64, wallpaper)
    }

    @Test fun widgetPictures() {
        widget("widget-large", sample, true)
        widget("widget-large-on-dark", sample, true, 0xFF15161C.toInt())
        widget("widget-small", sample, false)
        widget("widget-large-short", short, true)
        widget("widget-large-hidden", JSONObject(sample.toString()).put("hide", true), true)
        widget("widget-large-signed-out", null, true)
        widget("widget-small-signed-out", null, false)
    }

    @Test fun lockScreenPictures() {
        for ((name, night) in listOf("lock-light" to false, "lock-dark" to true)) {
            RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
            val v = LayoutInflater.from(c).inflate(R.layout.activity_main, FrameLayout(c), false)
            v.findViewById<View>(R.id.web).visibility = View.INVISIBLE
            v.findViewById<View>(R.id.lock).visibility = View.VISIBLE
            save(name, v, 411, 760, 0xFF000000.toInt())
        }
    }

    @Test fun widgetKeepsTheCurveAndDropsNumbersAfterSignOut() {
        Prefs.setDeviceKey(c, "k".repeat(43))
        WidgetStore.fromApp(c, sample.toString())
        val server = JSONObject(sample.toString()).put("at", sample.getLong("at") + 1000).put("daily", 1100); server.remove("curve")
        assertTrue(WidgetStore.fromServer(c, server, "k".repeat(43)))
        val w = WidgetStore.read(c)!!
        assertEquals(1100, w.getInt("daily"))
        assertTrue("the curve was wiped", w.has("curve"))
        // older server numbers don't replace newer ones from the app
        WidgetStore.fromServer(c, JSONObject(sample.toString()).put("at", 1).put("daily", 5), "k".repeat(43))
        assertEquals(1100, WidgetStore.read(c)!!.getInt("daily"))
        // signed out while the job ran: its numbers are dropped
        Account.signedOut(c)
        assertFalse(WidgetStore.fromServer(c, server, "k".repeat(43)))
        assertEquals(null, WidgetStore.read(c))
    }

    private fun alert(key: String, at: Long, channel: String = "normal") =
        JSONObject().put("key", key).put("title", "T $key").put("body", "B").put("url", "/#/cards").put("channel", channel).put("at", at)

    @Test fun alertsShowOnceWaitOutQuietHoursAndSkipOldNews() {
        val nm = shadowOf(c.getSystemService(NotificationManager::class.java))
        Notifier.createChannels(c)
        val now = System.currentTimeMillis()
        val list = JSONArray().put(alert("bill-3|a", now)).put(alert("bill-over|b", now, "overdue")).put(alert("digest|old", now - 5 * 3_600_000L))
        Notifier.showAlerts(c, list, now, hour = 23)                 // quiet hours: nothing, nothing marked
        assertEquals(0, nm.allNotifications.size)
        Notifier.showAlerts(c, list, now, hour = 9)                  // morning: the two new ones; the old summary is dropped
        assertEquals(2, nm.allNotifications.size)
        assertEquals(Notifier.CH_OVERDUE, nm.allNotifications.map { it.channelId }.first { it == Notifier.CH_OVERDUE })
        Notifier.showAlerts(c, list, now, hour = 10)                 // shown once
        assertEquals(2, nm.allNotifications.size)
    }

    @Test fun webAssetsAreServedForTheSiteOnly() {
        val s = AssetServer(c)
        assertEquals(null, s.serve(android.net.Uri.parse("https://example.com/index.html"), "GET"))
        assertEquals(null, s.serve(android.net.Uri.parse("https://yash-money.pages.dev/index.html"), "POST"))
        val sw = s.serve(android.net.Uri.parse("https://yash-money.pages.dev/sw.js"), "GET")!!
        assertTrue(sw.data.bufferedReader().readText().contains("unregister"))
    }
}
