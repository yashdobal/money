/* Money RN · the core: storage, your account (Supabase), and the engine (the website's own engine.js, generated into
   engine.gen.js) wired to React. Screens read figures straight from the engine (E.heroModel(), E.allCards() …) and
   change things through its actions (E.act.*), exactly as the website does; every change re-renders through useTick(). */
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { makeEngine } from "./engine.gen";
import CONFIG from "./config.json";
import { WEB, inApp, call, authStore, signInFromLink, adoptOldSite } from "./host";

export const SUPABASE_URL = CONFIG.SUPABASE_URL;
export const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY;

/* ---------------- storage: the engine's localStorage, kept in AsyncStorage and read into memory at start ---------------- */
const mem = {};
const PREFIX = "ls:";
export const storage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); AsyncStorage.setItem(PREFIX + k, String(v)).catch(() => {}); },
  removeItem: (k) => { delete mem[k]; AsyncStorage.removeItem(PREFIX + k).catch(() => {}); },
};
export async function preload() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    (await AsyncStorage.multiGet(keys)).forEach(([k, v]) => { if (v !== null && v !== undefined) mem[k.slice(PREFIX.length)] = v; });
  } catch (e) {}
  adoptOldSite(mem, PREFIX);                           // the website, first time after the old one: its saved data and look
}
export const pref = {
  get: (k, d) => { const v = storage.getItem("pref-" + k); return v === null ? d : v; },
  set: (k, v) => { if (v === null || v === undefined) storage.removeItem("pref-" + k); else storage.setItem("pref-" + k, String(v)); bump(); },
};

/* ---------------- secure storage: the device key for background work. As a website there is none to keep here:
   inside the Android app the app holds its own key (host.js), and a browser does no background work. ---------------- */
const webSecure = {};
export const secure = {
  get: async (k) => { try { return Platform.OS === "web" ? webSecure[k] || null : await SecureStore.getItemAsync(k); } catch (e) { return null; } },
  set: async (k, v) => { try { if (Platform.OS === "web") webSecure[k] = v; else if (v === null) await SecureStore.deleteItemAsync(k); else await SecureStore.setItemAsync(k, v); } catch (e) {} },
};

/* ---------------- re-rendering: one counter every screen follows ---------------- */
let tick = 0, ver = 0;
const subs = new Set();
/** Something changed: redraw. chrome = only navigation or the app bar changed (not your data or settings), so screens
    that are already drawn can be shown as they are. */
export function bump(chrome) { if (!chrome) ver++; tick++; subs.forEach((f) => f()); }
export const dataVer = () => ver;
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
/** Be told whenever anything changes, without re-rendering (alive.js starts and stops its loops this way). */
export const onChange = subscribe;
export const useTick = () => useSyncExternalStore(subscribe, () => tick, () => tick);

/** What the app chrome shows: the feed line under the title, busy, the last save, toasts. */
export const ui = { feed: { cls: "idle", txt: "Starting up" }, busy: false, toast: null, toastFn: null };
export function toast(msg, o) { if (ui.toastFn) ui.toastFn(msg, o || {}); }

/* ---------------- your account ---------------- */
// the web preview's test pages put a stand-in Supabase on globalThis.supabase (tools/rn/fake.mjs); the phone never has one
// the demo build (the emulator check) runs on made-up data, signed in
const DEMO = process.env.EXPO_PUBLIC_MONEY_DEMO === "1";
const fake = DEMO || (typeof globalThis !== "undefined" && globalThis.supabase && globalThis.supabase.createClient);
export const sb = DEMO ? require("./demo").demoClient() : fake ? globalThis.supabase.createClient() : createClient(SUPABASE_URL, SUPABASE_KEY, {
  // as a website: the sign-in lives where the old website kept it (host.js), and a sign-in link in the address is read
  auth: { storage: authStore || AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: WEB && (signInFromLink(SUPABASE_URL) || true) },
});
if (!fake && Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => { if (s === "active") sb.auth.startAutoRefresh(); else sb.auth.stopAutoRefresh(); });
}

export const session = { current: null, ready: false };
export async function readSession() {
  const { data } = await sb.auth.getSession();
  session.current = data.session || null; session.ready = true; bump();
  return session.current;
}
sb.auth.onAuthStateChange((event, s) => { session.current = s || null; session.ready = true; bump(); });
export const email = () => (session.current && session.current.user && session.current.user.email) || storage.getItem("money-email") || "";

/** The app function (supabase/functions/app): save, refresh, register-device. */
export async function callApp(body) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(SUPABASE_URL + "/functions/v1/app", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: "Bearer " + (data.session && data.session.access_token) },
    body: JSON.stringify(body),
  });
  let out = {};
  try { out = await res.json(); } catch (e) {}
  return { status: res.status, out };
}

let stateVersion = 0;
let inFlight = null, queued = null;
function saveSettings(settings) {
  if (inFlight) {
    if (queued) { queued.settings = settings; return queued.promise; }
    queued = { settings };
    queued.promise = inFlight.catch(() => {}).then(() => { const q = queued; queued = null; return saveSettings(q.settings); });
    return queued.promise;
  }
  inFlight = saveOnce(settings).finally(() => { inFlight = null; });
  return inFlight;
}
async function saveOnce(settings) {
  let status, out;
  try { ({ status, out } = await callApp({ action: "save", settings, baseVersion: stateVersion })); }
  catch (e) { offline.mark("settings"); throw new Error("You're offline. Saved on this phone; it'll sync when you're back online."); }
  offline.clear("settings");
  if (status === 200) { stateVersion = out.version; return { ok: true, version: out.version }; }
  if (status === 409) { setTimeout(() => E.load(), 300); return { ok: false, conflict: true }; }
  throw new Error(out.error || "Save failed (" + status + ")");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function refreshNow() {
  const feed = (t) => { ui.feed = { cls: "warn", txt: t }; bump(); };
  try {
    const { status, out } = await callApp({ action: "refresh" });
    if (status !== 200) throw new Error(out.error || "refresh " + status);
    const asked = out.requestedAt;
    for (let i = 0; i < 38; i++) {
      feed(i < 2 ? "Asking the collector to check Gmail…" : "Checking Gmail… (" + i * 4 + " s)");
      await sleep(4000);
      const { data } = await sb.from("ingest_log").select("received_at").eq("kind", "sync").eq("result", "saved").order("received_at", { ascending: false }).limit(1);
      if (data && data[0] && Date.parse(data[0].received_at) > asked) return true;
    }
    feed("The collector didn't answer yet; showing the latest data.");
    return false;
  } catch (e) { feed("Couldn't reach the collector: " + (e.message || e)); return false; }
}

async function all(table, select, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (order) q = q.order(order, { ascending: true, nullsFirst: false });
    const { data, error } = await q;
    if (error) throw new Error(table + ": " + error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const missingTable = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message || ""));
async function readEdits() {
  try {
    const [r, n] = await Promise.all([
      sb.from("payee_rules").select("pattern,category"),
      sb.from("txn_notes").select("txn_ref,category,for_someone_else,paid_back,note"),
    ]);
    if (r.error || n.error) { if (missingTable(r.error) || missingTable(n.error)) MONEY.notesChecked = true; return { ok: false }; }
    MONEY.notesChecked = false;
    return E.shapeEdits(r.data, n.data);
  } catch (e) { return { ok: false }; }
}
const must = ({ error }) => { if (error) throw new Error(error.message); };

async function getData() {
  const [tx, emails, pays, goals, contribs, rules, settings, log, edits] = await Promise.all([
    all("transactions", "source_ref,occurred_at,amount,direction,description,counted,snippet,sheet_row,deleted_at,accounts(kind,aliases),categories(name)", "sheet_row"),
    all("card_emails", "message_id,received_at,kind,amount,minimum_due,due_date,statement_date,sender,sheet_row,deleted_at,accounts(last4,issuer)", "sheet_row"),
    all("card_payments", "source_ref,account_label,paid_on,amount,matched_by,sheet_row,deleted_at", "sheet_row"),
    all("goals", "id,name,target,start_amount,target_date,priority,deleted_at", "created_at"),
    all("goal_contributions", "id,goal_id,amount,on_date,deleted_at", "on_date"),
    all("rules", "pattern,deleted_at,categories(name)", "priority"),
    all("settings", "key,value"),
    sb.from("ingest_log").select("received_at").eq("kind", "sync").eq("result", "saved").order("received_at", { ascending: false }).limit(1),
    readEdits(),
  ]);
  const data = E.shapeData({ tx, emails, pays, goals, contribs, rules, settings, edits,
    lastSync: log.data && log.data[0] ? log.data[0].received_at : null });
  stateVersion = data.appVersion;
  return data;
}

/** What the engine calls (window.MONEY on the website). */
export const MONEY = {
  notesChecked: false,
  email,
  serverCall(name, arg) {
    if (name === "getData") return getData();
    if (name === "saveSettings") return saveSettings(arg);
    return Promise.reject(new Error("Unknown call: " + name));
  },
  refreshNow,
  saveRule: (pattern, category) => offline.write({ t: "rule", pattern, category }),
  deleteRule: (pattern) => offline.write({ t: "unrule", pattern }),
  saveNote: (ref, row) => offline.write({ t: "note", ref, row }),
};

/* ---------------- offline: changes wait on the phone and go out when you're back online ---------------- */
async function writeNow(w) {
  if (w.t === "rule") return must(await sb.from("payee_rules").upsert({ pattern: w.pattern, category: w.category }, { onConflict: "user_id,pattern" }));
  if (w.t === "unrule") return must(await sb.from("payee_rules").delete().eq("pattern", w.pattern));
  if (w.t === "note") {
    if (!w.row) return must(await sb.from("txn_notes").delete().eq("txn_ref", w.ref));
    const r = w.row;
    return must(await sb.from("txn_notes").upsert({ txn_ref: w.ref, category: r.category, for_someone_else: r.for_someone_else, paid_back: r.paid_back, note: r.note }, { onConflict: "user_id,txn_ref" }));
  }
}
const isNet = (e) => /network|fetch|timed? ?out|offline|Failed to fetch/i.test(String((e && e.message) || e));
export const offline = {
  flags: {},
  mark(k) { this.flags[k] = true; },
  clear(k) { delete this.flags[k]; },
  queue() { try { return JSON.parse(storage.getItem("money-queue") || "[]"); } catch (e) { return []; } },
  waiting() { return !!this.flags.settings || this.queue().length > 0; },
  /** A note or payee rule: written now, or kept for later when there's no connection. */
  async write(w) {
    if (this.queue().length) { this.keep(w); return; }
    try { await writeNow(w); }
    catch (e) { if (!isNet(e)) throw e; this.keep(w); toast("You're offline. Saved on this phone; it'll sync when you're back online.", { tone: "warn" }); }
  },
  keep(w) { const q = this.queue(); q.push(w); storage.setItem("money-queue", JSON.stringify(q)); },
  /** Send whatever is waiting (on coming back to the app, and every minute). */
  async flush() {
    let q = this.queue(), sent = 0;
    while (q.length) {
      try { await writeNow(q[0]); } catch (e) { if (isNet(e)) return; }
      q.shift(); sent++; storage.setItem("money-queue", JSON.stringify(q));
    }
    if (this.flags.settings && E.DATA_IN) { try { E.queueSave(); } catch (e) {} }
    if (sent) toast("Synced the changes you made offline");
  },
};
setInterval(() => { if (offline.waiting()) offline.flush(); }, 60000);
AppState.addEventListener("change", (st) => { if (st === "active" && offline.waiting()) offline.flush(); });

/* ---------------- the engine ---------------- */
const UI = {
  // SMS first: unmatched SMS payments join the transactions before anything draws (no-op when it's off)
  render: () => { try { require("./native/sms").inject(); } catch (e) {} bump(); },
  busy: (on) => { ui.busy = !!on; bump(true); },
  feed: (f) => { ui.feed = f; bump(true); },
  saved: (msg) => { if (/another device/.test(msg)) toast(msg, { tone: "warn" }); else if (/this device/.test(msg)) toast(msg, { tone: "warn", ms: 4000 }); bump(); },
  toast: (msg, o) => toast(msg, o),
};
const doc = {
  get hidden() { return WEB ? document.hidden : AppState.currentState !== "active"; },
  addEventListener(name, fn) { if (name === "visibilitychange") AppState.addEventListener("change", () => fn()); },
  getElementById: () => null,
  // the engine escapes text for HTML; here it's drawn as text, so nothing to escape
  createElement: () => ({ textContent: "", get innerHTML() { return String(this.textContent); } }),
};
const win = { MONEY, UI };
export const E = makeEngine({ window: win, localStorage: storage, document: doc });
win.load = () => E.load();

let started = false;
/** Signed in: draw what was saved on the phone, then load the latest. */
export function startEngine() {
  if (started) return;
  started = true;
  E.start();
}

/* ---------------- this phone's device key (background work: widget numbers and alerts) ---------------- */
export async function registerDevice() {
  if (WEB) {
    // inside the Android app: a key for the app's own background work (widget numbers and alerts), once per sign-in
    try {
      if (!inApp || call("hasDeviceKey")) return false;
      const { status, out } = await callApp({ action: "register-device", name: "Android app" });
      if (status === 200 && out.token) call("setDeviceKey", out.token);
    } catch (e) {}
    return false;
  }
  try {
    if (await secure.get("deviceKey")) return true;
    const { status, out } = await callApp({ action: "register-device", name: "Money RN" });
    if (status === 200 && out.token) { await secure.set("deviceKey", out.token); return true; }
  } catch (e) {}
  return false;
}

/** The device function (supabase/functions/device) with this phone's key. */
export async function deviceCall(body) {
  const key = await secure.get("deviceKey");
  if (!key) return { status: 0, key: null };
  const res = await fetch(SUPABASE_URL + "/functions/v1/device", {
    method: "POST", headers: { "content-type": "application/json", apikey: SUPABASE_KEY, "x-device-token": key }, body: JSON.stringify(body || {}),
  });
  let out = {}, text = "";
  try { text = await res.text(); out = JSON.parse(text); } catch (e) {}
  return { status: res.status, out, key, unknown: res.status === 401 && /unknown device/.test(text) };
}

export async function signOut() {
  try { await Promise.race([deviceCall({ action: "forget" }), sleep(4000)]); } catch (e) {}
  await secure.set("deviceKey", null);
  call("signedOut");                                   // the Android app forgets its key and clears the widget
  await Promise.race([sb.auth.signOut({ scope: "local" }).catch(() => {}), sleep(4000)]);
  try { await AsyncStorage.clear(); } catch (e) {}
  Object.keys(mem).forEach((k) => delete mem[k]);
  try { const w = require("./native/widget"); await w.clearWidget(); } catch (e) {}
  if (WEB) { location.replace(location.pathname); return; }
  try { const { reloadAppAsync } = require("expo"); await reloadAppAsync("signed out"); } catch (e) {}
}
