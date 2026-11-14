package com.yashdobal.money

import android.net.Uri

/** The website the app carries inside it. Pages are served from the APK for this address (see AssetServer). */
object Site {
    const val HOST = "yash-money.pages.dev"
    const val ORIGIN = "https://$HOST"

    fun isOurs(u: Uri?): Boolean = u != null && u.scheme == "https" && u.host == HOST

    /** "#/today?sheet=add" or "/#/cards" → https://yash-money.pages.dev/#/today?sheet=add */
    fun at(route: String): String = "$ORIGIN/" + route.trimStart('/')
}
