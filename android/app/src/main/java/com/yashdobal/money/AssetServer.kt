package com.yashdobal.money

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Serves the web app built into the APK (assets/web, copied there by the syncWeb Gradle task) for the site's real
 * https address, so sign-in, storage and the database calls work exactly as on the website. Anything that isn't in
 * the APK (Supabase, for one) goes to the network as usual.
 */
class AssetServer(private val context: Context) {

    fun serve(url: Uri?, method: String?): WebResourceResponse? {
        if (method != "GET" || url == null || !Site.isOurs(url)) return null
        var path = url.path ?: "/"
        if (path.isEmpty() || path.endsWith("/")) path += "index.html"
        if (path.contains("..")) return null
        if (path == "/sw.js") return respond("text/javascript", ByteArrayInputStream(RETIRE_WORKER.toByteArray()))
        val body = try {
            context.assets.open("web$path")
        } catch (e: IOException) {
            return null
        }
        return respond(mimeOf(path), body)
    }

    private fun respond(mime: String, body: InputStream): WebResourceResponse {
        val text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")
        val headers = mutableMapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        // no frames of any kind in the app's pages, so nothing from another site can sit inside them and reach
        // window.AndroidBridge (WebView adds the bridge to every frame)
        if (mime == "text/html") headers["Content-Security-Policy"] = "frame-src 'none'; child-src 'none'; object-src 'none'"
        return WebResourceResponse(mime, if (text) "utf-8" else null, 200, "OK", headers, body)
    }

    private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "ico" -> "image/x-icon"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    companion object {
        /** In place of the website's service worker: one that removes itself and reloads its pages, so an old version
         *  can never keep serving old screens inside the app. */
        const val RETIRE_WORKER = """
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(self.registration.unregister()
    .then(function () { return self.clients.matchAll({ type: "window" }); })
    .then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); }));
});
"""
    }
}
