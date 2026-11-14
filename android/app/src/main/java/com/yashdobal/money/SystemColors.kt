package com.yashdobal.money

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The phone's Material You colours (Android 12 and later, taken from the wallpaper), for the app's "System" colour
 * theme: the primary tone for light pages (600) and for dark pages (200), and the secondary for good measure.
 * Older phones have none, so this is "{}" and the page keeps its own colours.
 */
object SystemColors {
    @SuppressLint("InlinedApi")
    fun json(c: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "{}"
        fun hex(id: Int) = String.format("#%06X", 0xFFFFFF and ContextCompat.getColor(c, id))
        return JSONObject()
            .put("light", hex(android.R.color.system_accent1_600))
            .put("dark", hex(android.R.color.system_accent1_200))
            .put("light2", hex(android.R.color.system_accent2_600))
            .put("dark2", hex(android.R.color.system_accent2_200))
            .toString()
    }
}
