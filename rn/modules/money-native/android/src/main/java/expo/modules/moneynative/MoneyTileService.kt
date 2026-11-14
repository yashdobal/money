package expo.modules.moneynative

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** The Quick Settings tile: shows what the app last worked out (Safe to spend, a day's share); tap opens Money. */
class MoneyTileService : TileService() {
  override fun onStartListening() { show() }
  override fun onTileAdded() { show() }

  private fun show() {
    val t = qsTile ?: return
    val p = getSharedPreferences(MoneyNativeModule.PREFS, MODE_PRIVATE)
    t.label = p.getString("tileLabel", null) ?: "Safe to spend"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.subtitle = p.getString("tileSub", null) ?: "Open Money"
    t.state = Tile.STATE_ACTIVE
    t.updateTile()
  }

  override fun onClick() {
    val i = packageManager.getLaunchIntentForPackage(packageName) ?: return
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(i)
    }
  }
}
