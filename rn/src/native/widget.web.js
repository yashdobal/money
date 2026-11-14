/* The home-screen widget, when Money runs as a website (the phone app's is widget.js). A browser has none. Inside the
   Android app the widget is the app's own (android/…/Widget.kt): the page hands it the numbers it has just worked
   out (the engine's widgetModel, the same one the server uses), at most once every ten minutes unless they change. */
import { inApp, call } from "../host";

export const WIDGET = "Money", SMALL = "MoneySmall";
export let refreshing = false;
export const setRefreshing = (v) => { refreshing = v; };
let timer = null, lastKey = "", lastAt = 0;
export function pushWidget(force) {
  if (!inApp) return;
  const { E, pref } = require("../store");
  if (!E.DATA_IN) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const w = Object.assign(E.widgetModel(), { hide: pref.get("hide", "0") === "1" }), key = JSON.stringify(Object.assign({}, w, { at: 0 }));
      if (!force && key === lastKey && Date.now() - lastAt < 10 * 60000) return;
      lastKey = key; lastAt = Date.now();
      call("pushWidget", JSON.stringify(w));
    } catch (e) { console.error(e); }
  }, force ? 0 : 600);
}
export async function clearWidget() { call("clearWidget"); }
export async function readWidget() { return null; }
export async function redraw() {}
export async function fromServer() {}
export async function widgetTaskHandler() {}
export async function pinWidget() { return false; }
export function openGallery() {}
export function WidgetGallery() { return null; }
export function MoneyWidget() { return null; }
