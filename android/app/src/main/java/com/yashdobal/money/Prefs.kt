package com.yashdobal.money

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** What the app keeps on the phone. Nothing here is backed up or copied to another phone (xml/data_rules.xml). */
object Prefs {
    private fun p(c: Context): SharedPreferences = c.getSharedPreferences("money", Context.MODE_PRIVATE)

    /** The Supabase sign-in, written by the page through AndroidBridge.sessionSet. */
    fun session(c: Context): SharedPreferences = c.getSharedPreferences("session", Context.MODE_PRIVATE)

    /* the fingerprint lock: on unless you turned it off (and only when the phone has a screen lock) */
    fun lockOn(c: Context): Boolean = p(c).getBoolean("lock", true)
    fun setLockOn(c: Context, on: Boolean) = p(c).edit().putBoolean("lock", on).apply()
    fun lockAfter(c: Context): Int = p(c).getInt("lockAfter", 60)
    fun setLockAfter(c: Context, seconds: Int) = p(c).edit().putInt("lockAfter", seconds).apply()
    fun hideRecents(c: Context): Boolean = p(c).getBoolean("secure", false)
    fun setHideRecents(c: Context, on: Boolean) = p(c).edit().putBoolean("secure", on).apply()

    /* the device key for background work (see supabase/functions/device) */
    fun deviceKey(c: Context): String? = p(c).getString("deviceKey", null)
    fun setDeviceKey(c: Context, key: String?) = p(c).edit().apply { if (key == null) remove("deviceKey") else putString("deviceKey", key) }.apply()

    /* notifications: whether Android has already asked once */
    fun askedNotif(c: Context): Boolean = p(c).getBoolean("askedNotif", false)
    fun setAskedNotif(c: Context) = p(c).edit().putBoolean("askedNotif", true).apply()

    /* the widget's numbers (JSON from the engine's widgetModel) */
    fun widget(c: Context): String? = p(c).getString("widget", null)
    fun setWidget(c: Context, json: String?) = p(c).edit().apply { if (json == null) remove("widget") else putString("widget", json) }.apply()

    /* alerts already shown: key → when */
    fun shown(c: Context): JSONObject = try { JSONObject(p(c).getString("shown", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    fun setShown(c: Context, o: JSONObject) = p(c).edit().putString("shown", o.toString()).apply()

    /** Signing out: the device key, the widget, the alerts list and the sign-in go; the lock settings stay. */
    fun clearSignedIn(c: Context) {
        p(c).edit().remove("deviceKey").remove("widget").remove("shown").apply()
        session(c).edit().clear().apply()
    }
}
