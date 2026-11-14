/* Money RN · where you are: the screen, its filters, and the sheet on top. Addresses look like the website's:
   moneyrn://activity?cat=Groceries&sheet=tx:abc (also "#/activity?…" from alerts, which the server writes for both). */
import { bump, pref, storage } from "./store";
import { WEB } from "./host";

export const TABS = [
  { id: "today", label: "Today", icon: "white-balance-sunny", on: "white-balance-sunny" },
  { id: "plan", label: "Plan", icon: "tune-variant", on: "tune-variant" },
  { id: "cards", label: "Cards", icon: "credit-card-outline", on: "credit-card" },
  { id: "spend", label: "Spending", icon: "chart-bar", on: "chart-bar" },
  { id: "activity", label: "Activity", icon: "format-list-bulleted", on: "format-list-bulleted" },
  { id: "trips", label: "Trips", icon: "airplane", on: "airplane" },
];
const ORDER = TABS.map((t) => t.id).concat(["settings"]);

export const nav = { view: "today", params: {}, sheet: null, stack: [], seq: 0 };

export function go(view, params) {
  if (!ORDER.includes(view)) view = "today";
  if (view === "settings" && nav.view !== "settings") nav.stack.push({ view: nav.view, params: nav.params });
  if (view !== "settings") { nav.stack = []; storage.setItem("pref-view", view); }   // remembered for next launch (not a change to redraw for)
  if (nav.view !== view) console.log("[money] view " + nav.view + " -> " + view);
  nav.view = view; nav.params = params || {}; nav.seq++;
  syncUrl();
  bump(true);
}
export function setParams(mut) { const p = { ...nav.params }; mut(p); Object.keys(p).forEach((k) => { if (p[k] === undefined || p[k] === null || p[k] === "") delete p[k]; }); nav.params = p; syncUrl(); bump(); }
export function openSheet(spec) { nav.sheet = spec; syncUrl(); bump(true); }
export function closeSheet() { nav.sheet = null; syncUrl(); bump(true); }
/** Android Back: close a sheet, leave Settings, go to Today; false when there's nothing left. */
export function back() {
  if (nav.sheet) { closeSheet(); return true; }
  if (nav.view === "settings") { const p = nav.stack.pop() || { view: "today", params: {} }; nav.view = p.view; nav.params = p.params; nav.seq++; syncUrl(); bump(true); return true; }
  if (nav.view !== "today") { go("today"); return true; }
  return false;
}
/** Somewhere from a link (a shortcut, the widget, an alert): the screen first, then the sheet on top. */
export function openLink(url) {
  if (!url) return false;
  console.log("[money] link " + url);
  let m = String(url);
  const h = m.indexOf("#");
  m = h >= 0 ? m.slice(h + 1) : m.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  m = m.replace(/^\/+/, "");
  const i = m.indexOf("?"), path = (i < 0 ? m : m.slice(0, i)).replace(/\/$/, ""), q = new URLSearchParams(i < 0 ? "" : m.slice(i + 1));
  const sheet = q.get("sheet"); q.delete("sheet");
  nav.sheet = null;                                     // a link replaces whatever sheet was open
  const params = {}; q.forEach((v, k) => { params[k] = v; });
  go(ORDER.includes(path) ? path : "today", params);
  if (sheet) setTimeout(() => openSheet(sheet), 60);
  // the demo build only: show an effect on request (the emulator check uses these)
  if (process.env.EXPO_PUBLIC_MONEY_DEMO === "1" && params.fx) setTimeout(() => {
    if (params.fx === "coins") require("./fx").coinsNext();
    else if (params.fx === "widgets") require("./native/widget").openGallery();
    else require("./gl").burst(params.fx === "goal" ? "goal" : "paid");
  }, 900);
  return true;
}
/** Where the app opens: the screen you were on last (not Settings); as a website, where the address says. */
export function firstView() {
  const v = pref.get("view", "today"); nav.view = ORDER.includes(v) && v !== "settings" ? v : "today";
  if (WEB) startWeb();
}

/* ---------------- as a website: the address and the Back button ----------------
   The address always says where you are (#/cards?card=…&sheet=card:…), so a reload or a link opens the same place.
   Back does what Android's Back does in the phone app: close the sheet, leave Settings, go to Today, and only then
   leave the site. To make that work the page keeps one spare step in the browser's history: Back lands on the step
   under it, the app steps back once itself and puts the spare step back; with nothing left to close it lets you go.
   The Android app that carries the website calls the same two things directly: UI.back() and UI.open(route). */
const url = () => {
  const q = new URLSearchParams(nav.params || {});
  if (nav.sheet) q.set("sheet", nav.sheet);
  const qs = q.toString();
  return location.pathname + location.search + "#/" + nav.view + (qs ? "?" + qs : "");
};
function syncUrl() {
  if (!WEB || !started) return;
  try { history.replaceState(history.state, "", url()); } catch (e) {}
}
let started = false;
function startWeb() {
  if (started) return;
  const h = location.hash || "";
  if (/^#\//.test(h)) openLink(h);                      // opened at an address: go there
  started = true;
  try {
    // a sign-in link's address is the account client's to read and clear (store.js): leave it as it is for now
    const u = /(^|[#&])(access_token|error_description)=/.test(h) ? undefined : url();
    history.replaceState({ money: "base" }, "", u);
    history.pushState({ money: "spare" }, "", u);
    window.addEventListener("popstate", (e) => {
      const st = e.state && e.state.money;
      if (st === "base") { if (back()) history.pushState({ money: "spare" }, "", url()); else history.back(); }
      else if (!st && /^#\//.test(location.hash)) { openLink(location.hash); history.replaceState({ money: "spare" }, "", url()); }   // a link followed while the page is open
    });
    window.addEventListener("hashchange", () => { if (/^#\//.test(location.hash) && location.pathname + location.search + location.hash !== url()) { openLink(location.hash); syncUrl(); } });
  } catch (e) {}
  window.UI = { back: () => back(), open: (route) => openLink(route) };
}
/** Something tapped that says where to go ({view, cat, card, …} or {sheet}). */
export function goTo(g) {
  if (!g) return;
  if (g.sheet) return openSheet(g.sheet);
  const params = {};
  ["cat", "card", "acct", "m", "d", "q", "f"].forEach((k) => { if (g[k]) params[k] = g[k]; });
  go(g.view || "today", params);
}
