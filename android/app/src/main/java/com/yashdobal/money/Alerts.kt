package com.yashdobal.money

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Background work, with WorkManager:
 *   - every hour: ask the server (device function) for alerts and the widget's numbers;
 *   - every evening at 21:20: the same, so the 9 PM summary (sent by the server at 21:05) arrives on time;
 *   - ↻ on the widget, and right after you sign in: once, now.
 * Each has its own unique name and uses KEEP, so opening the app never cancels a job that's already waiting.
 */
object Alerts {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(c: Context) {
        val hourly = PeriodicWorkRequestBuilder<AlertsWorker>(1, TimeUnit.HOURS)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("alerts-hourly", ExistingPeriodicWorkPolicy.KEEP, hourly)
        scheduleSummary(c)
    }

    fun scheduleSummary(c: Context) {
        val now = Calendar.getInstance()
        val at = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, 21); set(Calendar.MINUTE, 20); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (!after(now)) add(Calendar.DAY_OF_MONTH, 1)
        }
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(at.time)
        val req = OneTimeWorkRequestBuilder<AlertsWorker>()
            .setInitialDelay(at.timeInMillis - now.timeInMillis, TimeUnit.MILLISECONDS)
            .setConstraints(online)
            .build()
        WorkManager.getInstance(c).enqueueUniqueWork("summary-$day", ExistingWorkPolicy.KEEP, req)
    }

    fun refreshNow(c: Context) {
        val req = OneTimeWorkRequestBuilder<AlertsWorker>().setConstraints(online).build()
        WorkManager.getInstance(c).enqueueUniqueWork("refresh-now", ExistingWorkPolicy.KEEP, req)
    }
}

class AlertsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val c = applicationContext
        val key = Prefs.deviceKey(c)
        if (key == null) {                       // not signed in on this phone (yet)
            WidgetProvider.refreshingSince = 0
            WidgetProvider.updateAll(c)
            return@withContext Result.success()
        }
        val r = Api.device(key, JSONObject())
        WidgetProvider.refreshingSince = 0
        when (r) {
            is Api.Res.Ok -> {
                // only if you're still signed in with the same key (you may have signed out while this ran)
                if (WidgetStore.fromServer(c, r.body.optJSONObject("widget"), key)) r.body.optJSONArray("alerts")?.let { Notifier.showAlerts(c, it) }
            }
            is Api.Res.Unknown -> {              // the server no longer knows this key: the page gets a new one next time
                if (Prefs.deviceKey(c) == key) {
                    Prefs.setDeviceKey(c, null)
                    WidgetStore.clear(c)
                }
            }
            is Api.Res.Failed -> {
                WidgetProvider.updateAll(c)
                if (runAttemptCount < 2) return@withContext Result.retry()
            }
        }
        WidgetProvider.updateAll(c)
        Alerts.scheduleSummary(c)
        Result.success()
    }
}

/** The server, for background work: supabase/functions/device, with this phone's device key. */
object Api {
    sealed class Res {
        class Ok(val body: JSONObject) : Res()
        object Unknown : Res()
        class Failed(val why: String) : Res()
    }

    fun device(key: String, body: JSONObject): Res {
        val conn = URL(BuildConfig.SUPABASE_URL + "/functions/v1/device").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("apikey", BuildConfig.SUPABASE_KEY)
            conn.setRequestProperty("x-device-token", key)
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            when (val code = conn.responseCode) {
                in 200..299 -> Res.Ok(JSONObject(conn.inputStream.bufferedReader().use { it.readText() }))
                // only the device function's own answer means the key is gone (not, say, the gateway refusing)
                401 -> if ((conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "").contains("unknown device")) Res.Unknown else Res.Failed("HTTP 401")
                else -> Res.Failed("HTTP $code")
            }
        } catch (e: Exception) {
            Res.Failed(e.toString())
        } finally {
            conn.disconnect()
        }
    }

    /** Signing out: the server forgets this phone's key. */
    fun forget(key: String) {
        device(key, JSONObject().put("action", "forget"))
    }
}

/** Signing out on this phone. */
object Account {
    fun signedOut(c: Context) {
        val key = Prefs.deviceKey(c)
        Prefs.clearSignedIn(c)                  // the device key, the widget, the alerts list, the sign-in
        WidgetProvider.updateAll(c)
        if (key != null) Thread { Api.forget(key) }.start()
    }
}
