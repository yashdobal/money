/* Alerts on the phone: two channels (Alerts, Overdue bills), nothing between 10 PM and 8 AM, each alert shown once.
   The alerts themselves come from the server (supabase/functions/device), the same ones the Money app shows. */
import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const HOUR = 3600000;
const SHOWN = "alerts-shown";

export function setup() {
  if (Platform.OS === "web") return;
  try {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    Notifications.setNotificationChannelAsync("alerts", { name: "Alerts", description: "Bills due, EMIs, your salary, a quiet collector and the 9 PM summary", importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
    // a bill alert carries buttons: record the payment you just made, or open the card
    Notifications.setNotificationCategoryAsync("bill", [
      { identifier: "pay", buttonTitle: "Record payment", options: { opensAppToForeground: true } },
      { identifier: "open", buttonTitle: "Open card", options: { opensAppToForeground: true } },
    ]).catch(() => {});
    Notifications.setNotificationChannelAsync("overdue", { name: "Overdue bills", description: "A card bill that is past its due date", importance: Notifications.AndroidImportance.HIGH }).catch(() => {});
  } catch (e) {}
}

/** "granted", "ask" (can ask now) or "blocked" (only Settings can allow it). */
export async function state() {
  if (Platform.OS === "web") return { permission: "ask" };
  try {
    const p = await Notifications.getPermissionsAsync();
    return { permission: p.granted || p.status === "granted" ? "granted" : p.canAskAgain ? "ask" : "blocked" };
  } catch (e) { return { permission: "ask" }; }
}

export async function post(title, body, url, channel, key) {
  if (Platform.OS === "web") return;
  const bill = /^bill/.test(key || "");
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url: url || "#/today", key: key || "" }, categoryIdentifier: bill ? "bill" : undefined }, trigger: { channelId: channel === "overdue" ? "overdue" : "alerts" } });
}
/** Which card a bill alert is about, from its title ("Gold card bill due tomorrow"). */
function cardOf(title) {
  const { E } = require("../store");
  const name = String(title || "").replace(/ bill .*$/i, "").trim().toLowerCase();
  return Object.keys(E.GROUPS || {}).find((k) => [k, E.GROUPS[k].name, E.GROUPS[k].short, E.cardShort && E.cardShort(k)].some((x) => x && String(x).toLowerCase() === name)) || null;
}
/** Tapped an alert (or one of its buttons). */
export function respond(r) {
  const { openLink } = require("../nav");
  const c = r && r.notification && r.notification.request.content;
  if (!c) return;
  const url = (c.data && c.data.url) || "#/today", act = r.actionIdentifier;
  const card = /^bill/.test((c.data && c.data.key) || "") || /bill/i.test(c.title || "") ? cardOf(c.title) : null;
  if (card && act === "pay") return openLink("#/cards?card=" + card + "&sheet=pay:" + card);
  if (card) return openLink("#/cards?card=" + card);
  openLink(url);
}

/** The test alert: asks for permission the first time, opens Settings when Android won't ask again.
    "shown" · "denied" · "settings:permission" */
export async function test() {
  const s = await state();
  if (s.permission === "blocked") { openSettings(); return "settings:permission"; }
  if (s.permission !== "granted") {
    const r = await Notifications.requestPermissionsAsync().catch(() => ({ granted: false }));
    if (!(r.granted || r.status === "granted")) return "denied";
  }
  await post("Test from Money", "Alerts work. Bills, EMIs and your salary will show up like this.", "#/today");
  return "shown";
}
export function say(r) {
  const { toast } = require("../store");
  if (r === "shown") toast("Test alert sent");
  else if (r === "denied") toast("Alerts stay off. You can turn them on here any time.", { tone: "warn" });
  else if (/^settings:/.test(r)) toast("Allow notifications for Money RN, then come back.", { tone: "warn", ms: 4500 });
}
export function openSettings() { Linking.openSettings().catch(() => {}); }
export function openSecuritySettings() { if (Platform.OS === "android") Linking.sendIntent("android.settings.SECURITY_SETTINGS").catch(() => Linking.openSettings()); }

/** Alerts from the server: shows the new ones, holds them during quiet hours, drops stale ones (as the Money app does). */
export async function showAlerts(alerts, now = Date.now()) {
  if (!Array.isArray(alerts) || Platform.OS === "web") return;
  const hour = new Date(now).getHours(), quiet = hour < 8 || hour >= 22;
  const can = !quiet && (await state()).permission === "granted";
  let shown = {};
  try { shown = JSON.parse((await AsyncStorage.getItem(SHOWN)) || "{}"); } catch (e) {}
  let changed = false;
  for (const a of alerts) {
    const key = a && a.key;
    if (!key || shown[key]) continue;
    const age = now - (a.at || now);
    if (age > (key.startsWith("digest|") ? 3 : 12) * HOUR) { shown[key] = now; changed = true; continue; }   // too old to be news
    if (!can) continue;                                                                                     // held for later
    try { await post(a.title, a.body, a.url, a.channel, key); shown[key] = now; changed = true; } catch (e) {}
  }
  Object.keys(shown).forEach((k) => { if (now - shown[k] > 10 * 24 * HOUR) { delete shown[k]; changed = true; } });
  if (changed) await AsyncStorage.setItem(SHOWN, JSON.stringify(shown)).catch(() => {});
}
