/* The fingerprint lock (or the phone's PIN), and hiding Money in recent apps (which also blocks screenshots). */
import { Platform } from "react-native";
import * as LA from "expo-local-authentication";
import * as SC from "expo-screen-capture";
import { pref } from "../store";

let avail = false;
/** "bio": the phone's fingerprint (or its PIN). The website has "pin" (its own 4-digit code) and "app" (lock.web.js). */
export const kind = "bio";
export const busy = { on: false, until: 0 };          // the prompt itself pauses the app: don't lock again because of it

export async function available() {
  if (Platform.OS === "web") return (avail = false);
  try { avail = (await LA.hasHardwareAsync()) && (await LA.getEnrolledLevelAsync()) > 0; } catch (e) { avail = false; }
  if (!avail) { try { avail = (await LA.getEnrolledLevelAsync()) >= 1; } catch (e) {} }   // a PIN with no fingerprint still works
  return avail;
}
export const info = () => ({ available: avail, enabled: pref.get("lock", "0") === "1", after: Number(pref.get("lockAfter", "60")), hideRecents: pref.get("secure", "0") === "1" });

/** Ask for the fingerprint (or the phone's PIN). */
export async function authenticate(prompt) {
  busy.on = true;
  try {
    const r = await LA.authenticateAsync({ promptMessage: prompt || "Unlock Money", cancelLabel: "Cancel", disableDeviceFallback: false, requireConfirmation: false });
    return r.success ? { ok: true } : { ok: false, message: r.error === "lockout" ? "Too many tries. Wait a moment, or use your phone PIN." : r.error === "user_cancel" || r.error === "system_cancel" ? "Not changed" : "That didn't work" };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
  finally { busy.on = false; busy.until = Date.now() + 1500; }
}
export async function setEnabled(on) {
  if (!(await available())) return { ok: false, message: "Set a screen lock on your phone first." };
  const r = await authenticate(on ? "Turn on the fingerprint lock" : "Turn off the fingerprint lock");
  if (r.ok) pref.set("lock", on ? "1" : null);
  return r;
}
export const setAfter = (sec) => pref.set("lockAfter", String(sec));
export async function setHideRecents(on) {
  pref.set("secure", on ? "1" : null);
  await applySecure();
}
export async function applySecure() {
  if (Platform.OS === "web") return;
  try { if (pref.get("secure", "0") === "1") await SC.preventScreenCaptureAsync("money"); else await SC.allowScreenCaptureAsync("money"); } catch (e) {}
}
/** Before something sensitive (changing a balance, signing out): ask for the fingerprint when the lock is on. */
export async function guard(prompt) {
  if (pref.get("lock", "0") !== "1" || Platform.OS === "web") return true;
  const r = await authenticate(prompt);
  if (!r.ok && r.message && r.message !== "Not changed") require("../store").toast(r.message, { tone: "warn" });
  return r.ok;
}
/** Whether the app opens locked. */
export const startsLocked = () => info().enabled;
export const held = { on: false };
