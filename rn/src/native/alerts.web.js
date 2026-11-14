/* Alerts, when Money runs as a website (the phone app's are alerts.js).
     Inside the Android app: the app shows them itself (android/…/Notifier.kt) from the server's list; Settings sends
       a test and opens the phone's settings, through the bridge.
     In a browser: web push. This browser's subscription is saved to your account, and the notify function sends to
       it; the service worker (sw.js) shows what arrives, even with the page closed. */
import { inApp, call, callJson, nextNative, LS } from "../host";
import CONFIG from "../config.json";

const canPush = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const where = inApp ? "app" : "browser";
export function setup() { if (!inApp) refreshSubscription(); }

/** "granted", "ask" (can ask now), "blocked" (only settings can allow it) or "none" (this browser can't). */
export async function state() {
  if (inApp) {
    const N = callJson("notifInfo") || {};
    return { permission: N.permission === "granted" && N.enabled !== false ? "granted" : N.permission === "blocked" ? "blocked" : "ask", muted: !!N.muted, links: String(call("linksVerified") || "unknown") };
  }
  if (!canPush()) return { permission: "none" };
  const p = Notification.permission;
  return { permission: p === "granted" && LS.get("money-push") === "1" ? "granted" : p === "denied" ? "blocked" : "ask" };
}

function b64ToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function saveSubscription(sub) {
  const { sb } = require("../store");
  const j = sub.toJSON(), ua = navigator.userAgent || "";
  const device = /Android/i.test(ua) ? "Android phone" : /Windows/i.test(ua) ? "Windows laptop" : /Mac/i.test(ua) ? "Mac" : "This device";
  const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device_name: device, failures: 0 }, { onConflict: "endpoint" });
  if (error) throw new Error(error.message);
}
/** Keep this browser's subscription fresh (endpoints can change). */
async function refreshSubscription() {
  try {
    if (!canPush() || Notification.permission !== "granted" || LS.get("money-push") !== "1") return;
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch (e) {}
}

/** The test alert: asks for permission the first time.
    "shown" · "saved" · "denied" · "none" · "settings:permission" | "settings:off" | "settings:channel" · "error:…" */
export async function test() {
  if (inApp) {
    const wait = nextNative("notif", 60000);
    const r = String(call("testNotification") || "");
    if (r) return r;                                   // answered at once; otherwise the app asks for permission first
    const d = await wait;
    return d ? String(d.status || "") : "";
  }
  if (!canPush()) return "none";
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return perm === "denied" ? "settings:permission" : "denied";
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
    await saveSubscription(sub);
    LS.set("money-push", "1");
    const { out } = await require("../store").callApp({ action: "test-push" });
    return out && out.delivered ? "shown" : "saved";
  } catch (e) { return "error:" + String((e && e.message) || e); }
}
export function say(r) {
  const { toast } = require("../store");
  r = String(r || "");
  const here = inApp ? "Money" : "this site";
  if (r === "shown") toast("Test alert sent");
  else if (r === "saved") toast("Alerts are on. They'll arrive here.");
  else if (r === "denied") toast("Alerts stay off. You can turn them on here any time.", { tone: "warn" });
  else if (r === "none") toast("This browser can't receive alerts. On Android, use Chrome.", { tone: "warn", ms: 4500 });
  else if (/^settings:permission/.test(r)) toast("Allow notifications for " + here + ", then come back.", { tone: "warn", ms: 4500 });
  else if (/^settings:off/.test(r)) toast("Notifications are off for Money. Turn them on, then come back.", { tone: "warn", ms: 4500 });
  else if (/^settings:channel/.test(r)) toast("Money's alerts are muted. Turn them on, then come back.", { tone: "warn", ms: 4500 });
  else if (/^error:/.test(r)) toast("Couldn't turn alerts on: " + r.slice(6), { tone: "warn", ms: 4500 });
}
export function openSettings() { call("openNotificationSettings"); }
export function openSecuritySettings() { call("openLockSettings"); }
export function openLinkSettings() { call("openLinkSettings"); }
export async function post() {}
export function respond() {}
export async function showAlerts() {}
