/* The lock, when Money runs as a website (the phone app's is lock.js).
     Inside the Android app: the app's own fingerprint lock stands in front of the page (android/…/LockGate.kt), so
       nothing is drawn here; Settings only switches it, through the bridge.            kind: "app"
     In a browser: a 4-digit code, like a phone PIN, asked after you've been away. It is kept only in this browser,
       and only as a salted PBKDF2-SHA-256 hash (never the digits), under the name the old website used, so a code
       you already set still works. Five wrong tries turn it off on this device and sign you out.   kind: "pin" */
import { inApp, call, callJson, nextNative, LS } from "../host";

export const kind = inApp ? "app" : "pin";
export const busy = { on: false, until: 0 };

const PIN_KEY = "money-pin", PIN_TRIES = "money-pin-tries", ACTIVE = "money-active";
export const MAX_TRIES = 5;
export const hasPin = () => !!LS.get(PIN_KEY);
const b64 = (u8) => btoa(String.fromCharCode(...u8)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pinHash(pin, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: iter }, key, 256)));
}
export async function setPin(pin) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), iter = 150000;
  LS.set(PIN_KEY, JSON.stringify({ v: 1, salt, iter, hash: await pinHash(pin, salt, iter) }));
  LS.del(PIN_TRIES);
  touch();
}
export function clearPin() { LS.del(PIN_KEY); LS.del(PIN_TRIES); }
/** {ok} · {ok: false, left} tries left · {ok: false, off: true}: too many, the code is now off on this device. */
export async function checkPin(pin) {
  let p = null; try { p = JSON.parse(LS.get(PIN_KEY) || "null"); } catch (e) {}
  if (p && (await pinHash(pin, p.salt, p.iter)) === p.hash) { LS.del(PIN_TRIES); touch(); return { ok: true }; }
  const n = Number(LS.get(PIN_TRIES) || 0) + 1;
  if (n < MAX_TRIES) { LS.set(PIN_TRIES, String(n)); return { ok: false, left: MAX_TRIES - n }; }
  clearPin();
  return { ok: false, off: true };
}
export const obviousPin = (c) => /^(\d)\1{3}$/.test(c) || ["1234", "4321", "0123", "3210", "1212", "6969", "2580", "0852"].includes(c);

/* when you were last here: stamped while the page is in front, read when you come back */
export const touch = () => { LS.set(ACTIVE, String(Date.now())); };
const AFTER = "money-lock-after";
const afterSec = () => { const v = Number(LS.get(AFTER)); return [0, 60, 300].includes(v) && LS.get(AFTER) !== null ? v : 300; };
/** Away long enough for the code to be asked again (the browser lock only). */
export const idle = () => hasPin() && Date.now() - Number(LS.get(ACTIVE) || 0) >= Math.max(1, afterSec()) * 1000;
/** Decided before anything else runs, so loading can't count as "being here". */
export const lockedAtStart = kind === "pin" && idle();
if (kind === "pin" && typeof document !== "undefined") {
  if (!lockedAtStart) touch();
  window.addEventListener("pagehide", () => { if (!held.on) touch(); });
  setInterval(() => { if (!document.hidden && !held.on) touch(); }, 30000);
}
/** While the lock screen is up nothing counts as being here. */
export const held = { on: lockedAtStart };
/** Whether the app opens locked. */
export const startsLocked = () => lockedAtStart;

export async function available() { return kind === "app" ? !!(callJson("lockInfo") || {}).available : !!(typeof crypto !== "undefined" && crypto.subtle); }
export function info() {
  if (kind === "app") {
    const L = callJson("lockInfo") || {};
    return { available: !!L.available, enabled: !!L.enabled, after: Number(L.after) || 0, hideRecents: !!L.hideRecents };
  }
  return { available: !!(typeof crypto !== "undefined" && crypto.subtle), enabled: hasPin(), after: afterSec(), hideRecents: false };
}
/** Inside the Android app: the app asks for the fingerprint and says how it went. (In a browser the code is set in
    its own sheet: Settings opens it.) */
export async function setEnabled(on) {
  if (kind !== "app") return { ok: false, message: "Set a code from Settings." };
  const wait = nextNative("lock", 120000);
  call("setLock", !!on);
  const d = await wait;
  return d ? { ok: !!d.ok, message: d.message || "" } : { ok: false, message: "Not changed" };
}
export function setAfter(sec) { if (kind === "app") call("setLockAfter", Number(sec)); else LS.set(AFTER, String(sec)); }
export async function setHideRecents(on) { call("setHideRecents", !!on); }
export async function applySecure() {}
export async function authenticate() { return { ok: kind === "app" }; }
/** Before something sensitive: the Android app has no prompt to ask through, and a browser's code was asked on the
    way in, so this lets it through. */
export async function guard() { return true; }
export const openSettings = () => call("openLockSettings");
