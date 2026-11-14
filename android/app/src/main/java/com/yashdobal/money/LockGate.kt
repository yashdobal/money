package com.yashdobal.money

import android.app.KeyguardManager
import android.os.SystemClock
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat

/**
 * The fingerprint lock: a native screen over the web app, opened with the fingerprint or the phone's PIN.
 *
 *  - It locks on a cold start, and after the chosen time away (right away, 1 minute or 5 minutes).
 *  - It is on by default when the phone has a screen lock; with no screen lock there's nothing to unlock with.
 *  - The time away isn't counted while the prompt itself is up (the PIN screen sends the app to the background).
 *  - After you cancel, it doesn't ask again by itself (that loops); the Unlock button asks.
 *  - Turning it on or off asks for the fingerprint first.
 *  - When the time away started is kept for the whole app, so Android rebuilding the screen while the app is in the
 *    background (a dark-theme schedule, a language change) can't skip the lock.
 */
class LockGate(
    private val act: MainActivity,
    private val overlay: View,
    private val text: TextView,
    button: Button,
    private val onLockedChange: (Boolean) -> Unit,
) {
    var locked = false
        private set
    private var promptShowing = false
    private var autoPrompt = true

    init {
        button.setOnClickListener { autoPrompt = true; prompt() }
    }

    /** The phone has a screen lock (PIN, pattern, password), so there's something to unlock with. */
    fun available(): Boolean = act.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true
    fun enabled(): Boolean = available() && Prefs.lockOn(act)

    private fun awayTooLong(): Boolean =
        awaySince > 0 && SystemClock.elapsedRealtime() - awaySince >= Prefs.lockAfter(act) * 1000L

    fun onCreate(coldStart: Boolean) {
        if (enabled() && (coldStart || awayTooLong())) lock()
    }

    fun onStart() {
        // back from the PIN screen of our own prompt: that time doesn't count
        if (stoppedForPrompt && promptShowing) return
        if (!locked && enabled() && awayTooLong()) lock()
        awaySince = 0
        stoppedForPrompt = false
    }

    fun onResume() {
        if (locked && autoPrompt && !promptShowing) overlay.post { if (locked && autoPrompt && !promptShowing) prompt() }
    }

    fun onStop(changingConfigurations: Boolean) {
        if (changingConfigurations) return
        awaySince = SystemClock.elapsedRealtime()
        stoppedForPrompt = promptShowing
        // "right away": show the lock screen now, so the recent-apps card and the way back show it too
        if (!promptShowing && !locked && enabled() && Prefs.lockAfter(act) == 0) lock()
    }

    private fun lock() {
        locked = true
        text.setText(R.string.lock_text)
        overlay.animate().cancel()
        overlay.alpha = 1f
        overlay.visibility = View.VISIBLE
        onLockedChange(true)
    }

    private fun unlock() {
        locked = false
        autoPrompt = true
        overlay.animate().alpha(0f).setDuration(160).withEndAction { if (!locked) overlay.visibility = View.GONE }.start()
        onLockedChange(false)
    }

    private fun prompt() {
        if (!locked || promptShowing) return
        if (!available()) { unlock(); return }          // the screen lock was removed: nothing to unlock with
        authenticate(act.getString(R.string.lock_prompt), null, onOk = { unlock() }) { code, msg ->
            autoPrompt = false                            // never loop: from here the Unlock button asks
            when (code) {
                BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED ->
                    text.setText(R.string.lock_text)
                BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> text.setText(R.string.lock_lockout)
                BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> unlock()
                else -> text.setText(msg)
            }
        }
    }

    /** Turning the lock on or off: confirm with the fingerprint or PIN first. done(ok, message if not). */
    fun requestToggle(on: Boolean, done: (Boolean, String?) -> Unit) {
        if (!available()) { done(false, act.getString(R.string.lock_need_screen_lock)); return }
        if (on == enabled()) { done(true, null); return }
        val title = act.getString(if (on) R.string.lock_turn_on else R.string.lock_turn_off)
        val asked = authenticate(title, act.getString(R.string.lock_confirm), onOk = {
            Prefs.setLockOn(act, on)
            done(true, null)
        }) { code, msg ->
            val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED
            done(false, if (cancelled) act.getString(R.string.not_changed) else msg.toString())
        }
        if (!asked) done(false, act.getString(R.string.not_changed))
    }

    /** Shows the prompt; false if it couldn't be shown just now (another one is up, or the screen is being saved). */
    private fun authenticate(title: String, subtitle: String?, onOk: () -> Unit, onError: (Int, CharSequence) -> Unit): Boolean {
        if (promptShowing || act.supportFragmentManager.isStateSaved) return false
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { if (subtitle != null) setSubtitle(subtitle) }
            .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)   // the phone's PIN works too
            .build()
        promptShowing = true
        BiometricPrompt(act, ContextCompat.getMainExecutor(act), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                promptShowing = false
                promptEnded(success = true, cancelledBySystem = false)
                onOk()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                promptShowing = false
                promptEnded(success = false, cancelledBySystem = errorCode == BiometricPrompt.ERROR_CANCELED)
                onError(errorCode, errString)
            }
        }).authenticate(info)
        return true
    }

    /** The prompt closed. If the app stopped only because the PIN screen was up, that wasn't time away. If Android
     *  cancelled it because you left the app (Home), the time away keeps counting. And if you cancel a PIN screen that
     *  was left open for a long time (you left the phone on it), that does count: the app locks. */
    private fun promptEnded(success: Boolean, cancelledBySystem: Boolean) {
        if (stoppedForPrompt && !cancelledBySystem) {
            val away = SystemClock.elapsedRealtime() - awaySince
            if (!success && !locked && enabled() && awaySince > 0 && away >= maxOf(Prefs.lockAfter(act) * 1000L, 30_000L)) lock()
            awaySince = 0
        }
        stoppedForPrompt = false
    }

    companion object {
        /** When the app last went to the background (elapsedRealtime), for the whole app: survives a rebuilt screen. */
        @Volatile private var awaySince = 0L
        @Volatile private var stoppedForPrompt = false
    }
}
