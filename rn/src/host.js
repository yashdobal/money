/* Money RN · the host. The same app runs in three places:
     the phone app (React Native proper): nothing here applies;
     a browser (yash-money.pages.dev): the browser is the host: its storage, its history and Back button, web push;
     the older Android app: it shows the website inside itself and adds window.AndroidBridge (android/…/Bridge.kt):
       the sign-in is kept by the app, the app's own fingerprint lock stands in front of the page, alerts and the
       home-screen widget are the app's, and links, Back and haptics go through it.
   Everything that depends on which of the last two it is lives here and in src/native/*.web.js. */
import { Platform } from "react-native";

export const WEB = Platform.OS === "web" && typeof window !== "undefined";
/** The Android app's bridge, when the page is running inside it. */
export const bridge = WEB && window.AndroidBridge && window.AndroidBridge.sessionGet ? window.AndroidBridge : null;
export const inApp = !!bridge;
export const call = (f, ...a) => { try { return bridge && bridge[f] ? bridge[f](...a) : null; } catch (e) { return null; } };
export const callJson = (f) => { try { return JSON.parse(call(f) || "null"); } catch (e) { return null; } };
/** What the Android app tells the page: {type: "lock", ok, enabled, message} · {type: "notif", status}. */
export function onNative(fn) {
  if (!WEB) return () => {};
  const h = (e) => fn((e && e.detail) || {});
  window.addEventListener("native", h);
  return () => window.removeEventListener("native", h);
}
/** The next message of one kind from the Android app (or null after ms). */
export const nextNative = (type, ms = 60000) => new Promise((res) => {
  let off = () => {};
  const t = setTimeout(() => { off(); res(null); }, ms);
  off = onNative((d) => { if (d.type === type) { clearTimeout(t); off(); res(d); } });
});

export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/** Where the sign-in is kept: inside the Android app, the app keeps it (so it survives clearing the page's data and is
    the same sign-in the app's background work uses); in a browser, the browser's storage, under the name the old
    website used, so you stay signed in across the change. undefined: the phone app's own storage. */
export const authStore = inApp ? {
  getItem: (k) => call("sessionGet", k),
  setItem: (k, v) => { call("sessionSet", k, v); },
  removeItem: (k) => { call("sessionDel", k); },
} : WEB ? {
  getItem: (k) => LS.get(k),
  setItem: (k, v) => LS.set(k, v),
  removeItem: (k) => LS.del(k),
} : undefined;

const linkInUrl = () => WEB && /(^|[#&])access_token=/.test(location.hash);
/** Before the account client starts. Inside the Android app a sign-in link arrives as ?h=<the link's #part> (only the
    part after # differs from the open page, so the app reloads with it as a parameter): use it only while signed out,
    because any app can open a link and a link must never swap the sign-in you already have. Returns whether the
    address holds a sign-in to read. */
export function signInFromLink(supabaseUrl) {
  if (!WEB) return false;
  if (inApp) {
    const signedIn = !!authStore.getItem("sb-" + new URL(supabaseUrl).hostname.split(".")[0] + "-auth-token");
    const h = new URLSearchParams(location.search).get("h");
    if (h && !signedIn) history.replaceState(null, "", location.pathname + "#" + h.replace(/^#/, ""));
    else if (h || (signedIn && linkInUrl())) history.replaceState(null, "", location.pathname + "#/today");
  }
  return linkInUrl();
}

/** Once: bring over what the old website kept in this browser (the last data it drew, your theme and colours), so the
    first screen is there at once and looks the way you left it. */
export function adoptOldSite(mem, PREFIX) {
  if (!WEB || LS.get("money-rn-adopted") === "1") return;
  try {
    const old = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("money-")) old[k] = localStorage.getItem(k); }
    const put = (k, v) => { if (v !== null && v !== undefined && !(k in mem)) { mem[k] = v; LS.set(PREFIX + k, v); } };
    Object.keys(old).forEach((k) => { if (!/^money-(pin|pin-tries|active|passkey|push|rn-)/.test(k)) put(k, old[k]); });
    if (old["money-theme"]) put("pref-theme", old["money-theme"]);
    if (old["money-palette"]) put("pref-palette", old["money-palette"]);
    if (old["money-fx"] === "0") put("pref-fx", "0");
    if (old["money-hide"] === "1") put("pref-hide", "1");
    if (old["money-push"] || old["money-push-later"]) put("pref-alertsOffered", "1");   // already answered the old site's offer
  } catch (e) {}
  LS.set("money-rn-adopted", "1");
}

/** A tick under your finger: the Android app's own haptics, or the browser's vibration where it has one. */
export function haptic(kind) {
  if (!WEB) return;
  if (inApp && bridge.haptic) { call("haptic", kind || "tick"); return; }
  try { if (navigator.vibrate) navigator.vibrate(kind === "error" ? [12, 60, 12] : kind === "confirm" ? 14 : kind === "heavy" ? 10 : 6); } catch (e) {}
}

/** The colour around the page: the browser's toolbar (theme-color), the page behind the app, and inside the Android
    app the status and navigation bars' icons. */
export function chrome(C) {
  if (!WEB) return;
  try {
    document.documentElement.style.backgroundColor = C.ground;
    document.body.style.backgroundColor = C.ground;
    document.documentElement.style.colorScheme = C.dark ? "dark" : "light";
    let m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    m.content = C.ground;
    document.querySelectorAll('meta[name="theme-color"][media]').forEach((x) => x.remove());
  } catch (e) {}
  call("setBars", !!C.dark);
}

/** The phone's own colours, inside the Android app (Android 12+): {light, dark} or null. */
export function systemSeeds() {
  const s = callJson("systemColors");
  return s && s.light && s.dark ? s : null;
}

/** Hand a file to the person: the Android app's share sheet, or a download in a browser. */
export function saveFile(name, text, mime) {
  if (!WEB) return false;
  if (inApp && bridge.shareFile) { call("shareFile", name, text, mime); return "shared"; }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "saved";
  } catch (e) { return false; }
}

/** A wide screen (a laptop): the sidebar and panels side by side. */
export const WIDE = 980;
