package expo.modules.moneynative

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.service.quicksettings.TileService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Money RN's own Android bits:
 *  - systemPalettes: the phone's Material You colours (Android 12+), five tonal palettes as "#RRGGBB" by tone.
 *  - setTile: what the Quick Settings tile shows.
 *  - readSms: recent text messages from banks (needs READ_SMS, which the app asks for when you turn it on).
 */
class MoneyNativeModule : Module() {
  companion object { const val PREFS = "money_native" }

  override fun definition() = ModuleDefinition {
    Name("MoneyNative")

    Function("systemPalettes") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function null
      val ctx = appContext.reactContext ?: return@Function null
      val res = ctx.resources
      val tones = listOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
      val out = mutableMapOf<String, Map<String, String>>()
      for (p in listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")) {
        val m = mutableMapOf<String, String>()
        for (t in tones) {
          val id = res.getIdentifier("system_${p}_$t", "color", "android")
          if (id != 0) m[t.toString()] = String.format("#%06X", 0xFFFFFF and res.getColor(id, null))
        }
        out[p] = m
      }
      out
    }

    Function("setTile") { label: String, sub: String ->
      val ctx = appContext.reactContext ?: return@Function false
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("tileLabel", label).putString("tileSub", sub).apply()
      try { TileService.requestListeningState(ctx, ComponentName(ctx, MoneyTileService::class.java)) } catch (e: Exception) {}
      true
    }

    Function("canReadSms") {
      val ctx = appContext.reactContext ?: return@Function false
      ctx.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
    }

    /** Messages received after `since` (ms), newest first, at most `limit`: [{address, body, date}]. */
    Function("readSms") { since: Double, limit: Int ->
      val ctx = appContext.reactContext ?: return@Function null
      if (ctx.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return@Function null
      val out = mutableListOf<Map<String, Any>>()
      val c = ctx.contentResolver.query(Uri.parse("content://sms/inbox"), arrayOf("address", "body", "date"),
        "date > ?", arrayOf(since.toLong().toString()), "date DESC") ?: return@Function out
      c.use {
        while (it.moveToNext() && out.size < limit) {
          out.add(mapOf("address" to (it.getString(0) ?: ""), "body" to (it.getString(1) ?: ""), "date" to it.getLong(2).toDouble()))
        }
      }
      out
    }
  }
}
