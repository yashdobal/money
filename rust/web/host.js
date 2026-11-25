/* What a browser does for Money that the app asks for by name (rust/app/src/native.rs):
     the service worker (sw.js): the app opens offline, and alerts sent to this browser show even with the page closed;
     window.moneyPush: web push, this browser's subscription for the 9 PM summary and bill alerts.
   Inside the Android app none of this runs: the app shows alerts itself (android/…/Notifier.kt). */
(function () {
  var inApp = !!window.AndroidBridge;
  if ("serviceWorker" in navigator && !inApp && location.protocol === "https:") {
    addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
  function can() { return !inApp && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function bytes(s) {
    var pad = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  function device() {
    var ua = navigator.userAgent || "";
    return /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows laptop" : /Mac/i.test(ua) ? "Mac" : "This device";
  }
  function sub(s) { var j = s.toJSON(); return JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device_name: device() }); }
  window.moneyPush = {
    /* "granted" (this browser has its subscription), "ask", "blocked" or "none" (this browser can't) */
    state: function (on) {
      if (!can()) return "none";
      var p = Notification.permission;
      return p === "granted" && on ? "granted" : p === "denied" ? "blocked" : "ask";
    },
    /* asks for permission, subscribes: the subscription as JSON for your account, or "denied" / "blocked" / "error:…" */
    enable: function (key) {
      if (!can()) return Promise.resolve("none");
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") return perm === "denied" ? "blocked" : "denied";
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (s) {
            return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) });
          });
        }).then(sub);
      }).catch(function (e) { return "error:" + ((e && e.message) || e); });
    },
    /* the current subscription as JSON, or "" (to keep your account's copy fresh: endpoints can change) */
    current: function () {
      if (!can() || Notification.permission !== "granted") return Promise.resolve("");
      return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (s) { return s ? sub(s) : ""; }).catch(function () { return ""; });
    },
  };
})();
