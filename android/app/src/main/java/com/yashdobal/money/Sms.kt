package com.yashdobal.money

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bank SMS, when you turn it on in Settings: the page asks for messages since a moment and reads each one as a payment
 * (rust/app/src/sms.rs). Only messages from your banks' senders ever leave this file (names like "VM-HDFCBK" or
 * "AX-AXISBK-S"; a person's number never matches), and the page keeps what it reads on this phone only.
 */
object Sms {
    /** The banks' sender names. Keep in step with BANKS in rust/app/src/sms.rs. */
    private val BANK = Regex("HDFC|AXIS|ICICI|SBI|AMZ|AMAZON", RegexOption.IGNORE_CASE)

    fun permitted(c: Context): Boolean = BuildConfig.SMS && ContextCompat.checkSelfPermission(c, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    /** "granted", "ask", "blocked" (Android won't ask again: only its settings can allow it), or "unsupported" (this
     *  is the APK without SMS reading). */
    fun state(act: Activity): String = when {
        !BuildConfig.SMS -> "unsupported"
        permitted(act) -> "granted"
        Prefs.askedSms(act) && !ActivityCompat.shouldShowRequestPermissionRationale(act, Manifest.permission.READ_SMS) -> "blocked"
        else -> "ask"
    }

    /** Bank messages after `since` (ms since 1970), newest first, at most `limit`: [{address, body, date}]. */
    fun read(c: Context, since: Long, limit: Int): String {
        val out = JSONArray()
        if (!permitted(c)) return out.toString()
        try {
            // the inbox's columns, by name (Telephony.TextBasedSmsColumns)
            c.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("address", "body", "date"),
                "date > ?", arrayOf(since.toString()), "date DESC")?.use { cur ->
                while (cur.moveToNext() && out.length() < limit.coerceIn(1, 1000)) {
                    val address = cur.getString(0) ?: continue
                    if (!BANK.containsMatchIn(address)) continue
                    out.put(JSONObject().put("address", address).put("body", cur.getString(1) ?: "").put("date", cur.getLong(2)))
                }
            }
        } catch (e: Exception) {}
        return out.toString()
    }
}
