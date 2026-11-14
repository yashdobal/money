/* The home-screen widget: what's safe to spend until payday, a day's share, the balance curve and your next bill.
   It lays itself out for whatever size you give it: a 1×1 square (the figure), a 1-row strip, a narrow column, the
   4×2 card, and from 3 rows up today's numbers and what's coming up (as many rows as fit). It wears the Safe to
   spend card's colours for your palette, light and dark, in the app's own font.
   Its numbers are the engine's widgetModel(): from the app while it's open, from the server (the same engine) in the
   background every hour. Tapping ↻ asks the server now. */
import React from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// the widget library is Android-only (it needs its native part), so the web preview never loads it
const W = Platform.OS === "android" ? require("react-native-android-widget") : {};
const { FlexWidget, TextWidget, SvgWidget, requestWidgetUpdate } = W;

const KEY = "widget-json";
export const WIDGET = "Money", SMALL = "MoneySmall";
export let refreshing = false;
export const setRefreshing = (v) => { refreshing = v; };

export async function readWidget() { try { return JSON.parse((await AsyncStorage.getItem(KEY)) || "null"); } catch (e) { return null; } }
async function writeWidget(w) { await AsyncStorage.setItem(KEY, JSON.stringify(w)).catch(() => {}); }

const inr = (v) => Math.round(Math.abs(v)).toLocaleString("en-IN");
const rupees = (v, hide) => (hide ? "₹••••" : (v < 0 ? "−" : "") + "₹" + inr(v));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmon = (iso) => { const d = new Date(iso + "T00:00:00"); return d.getDate() + " " + MON[d.getMonth()]; };
const hhmm = (ms) => { const d = new Date(ms); let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, "0"), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + m + " " + ap; };
const isoToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

function billText(b, hide) {
  if (!b) return "";
  const when = b.overdue > 0 ? b.overdue + (b.overdue === 1 ? " day" : " days") + " overdue" : b.n === 0 ? "due today" : b.n === 1 ? "due tomorrow" : "due " + dmon(b.due);
  return "Next: " + b.title + " " + rupees(b.amt, hide) + " · " + when;
}
/** The balance until the salary after next, as a step line, as SVG (w × h in its own units). */
function curveSvg(c, color, Wd = 600, H = 100) {
  if (!c || !c.pts || !c.pts.length) return null;
  const W = Wd, pad = 4, span = Math.max(1, c.span);
  const vals = c.pts.map((p) => p[1]).concat([0, c.buffer || 0]);
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const p0 = (hi - lo) * 0.12 || 1000; lo -= p0; hi += p0;
  const X = (d) => pad + ((W - 2 * pad) * Math.max(0, Math.min(span, d))) / span, Y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  let d = "M" + X(0).toFixed(1) + " " + Y(c.pts[0][1]).toFixed(1);
  c.pts.forEach((p, i) => { if (i) d += "H" + X(p[0]).toFixed(1); d += "V" + Y(p[1]).toFixed(1); });
  d += "H" + (W - pad);
  const pays = (c.paydays || []).map((p) => '<line x1="' + X(p).toFixed(1) + '" x2="' + X(p).toFixed(1) + '" y1="0" y2="' + H + '" stroke="' + color + '" stroke-opacity="0.22" stroke-width="2" stroke-dasharray="4 5"/>').join("");
  const zero = lo < 0 && hi > 0 ? '<line x1="0" x2="' + W + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="' + color + '" stroke-opacity="0.18" stroke-width="1.5"/>' : "";
  const low = c.low ? '<circle cx="' + X(c.low[0]).toFixed(1) + '" cy="' + Y(c.low[1]).toFixed(1) + '" r="6" fill="' + color + '"/>' : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' +
    '<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.28"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
    pays + zero + '<path d="' + d + 'V' + H + 'H' + pad + 'Z" fill="url(#f)"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linejoin="round"/>' + low + '</svg>';
}

/* The look: the Safe to spend card itself (the app's hero colours for your palette, light and dark), in Anek. */
const FONT = { hero: "Anek-Hero", fig: "Anek-Fig", semi: "Anek-Semi", medium: "Anek-Medium", body: "Anek-Body" };
function look(w, dark) {
  const t = (w && w.theme && w.theme[dark ? "dark" : "light"]) || {};
  return { a: t.a || (dark ? "#242424" : "#2A2A28"), b: t.b || (dark ? "#121212" : "#151515"), ink: t.ink || "#F5F5F3", ink2: t.ink2 || "rgba(245,245,243,0.64)",
    tile: "rgba(255,255,255,0.08)", btn: "rgba(255,255,255,0.12)", alert: "#F4A293", warn: "#EBC77A", pos: "#9BD8B0" };
}
const short = (v, hide) => (hide ? "₹••" : (v < 0 ? "−" : "") + "₹" + (Math.abs(v) >= 100000 ? (Math.abs(v) / 100000).toFixed(Math.abs(v) >= 1000000 ? 0 : 1).replace(/\.0$/, "") + "L" : Math.abs(v) >= 10000 ? Math.round(Math.abs(v) / 1000) + "k" : inr(v)));
const whenN = (n) => (n <= 0 ? "Today" : n === 1 ? "Tomorrow" : "In " + n + " days");
/** Which layout fits the size you've given it (in dp): it re-lays itself out as you resize it. */
function sizeOf(width, height) {
  const w = width || 320, h = height || 160;
  if (w < 130 && h < 130) return "tiny";
  if (h < 100) return "strip";
  if (w < 190) return "tall";
  if (h < 190) return "card";
  return "big";
}

function Btn_({ glyph, action, uri, L, size = 30 }) {
  return (
    <FlexWidget clickAction={action} clickActionData={uri ? { uri } : undefined}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: L.btn, justifyContent: "center", alignItems: "center", marginLeft: 6 }}>
      <TextWidget text={glyph} style={{ fontSize: size * 0.56, color: L.ink, fontFamily: FONT.medium }} />
    </FlexWidget>
  );
}

/** The widget, drawn from its numbers, laid out for its size: from a 1×1 square to a 4×4 panel. */
export function MoneyWidget({ w, dark, width, height }) {
  const L = look(w, dark), sz = sizeOf(width, height);
  const hide = !!(w && w.hide), ok = w && w.state === "ok";
  const W_ = width || 320, H_ = height || 160;
  const stamp = refreshing ? "Updating…" : !w || !w.at ? "" : w.day === isoToday() ? hhmm(w.at) : "from " + dmon(w.day);
  const msg = !w ? "Open Money RN to see today's figure" : w.state === "noinc" ? "Set your salary in Money" : w.state === "nobal" ? "Set your bank balances in Money" : "Open Money RN to see today's figure";
  const alertTone = ok && w.tone === "alert";
  const root = { height: "match_parent", width: "match_parent", backgroundGradient: { from: L.a, to: L.b, orientation: "TL_BR" }, borderRadius: sz === "tiny" ? 26 : 28 };
  const open = { clickAction: "OPEN_URI", clickActionData: { uri: "moneyrn://today" } };
  const fig = (size, compact) => <TextWidget text={ok ? (compact ? short(w.left, hide) : rupees(w.left, hide)) : "₹—"} maxLines={1} adjustsFontSizeToFit style={{ fontSize: size, color: alertTone ? L.alert : L.ink, fontFamily: FONT.hero, letterSpacing: -0.02 }} />;
  const daily = ok ? (hide ? "₹•• a day" : rupees(w.daily) + " a day") : "";
  const bill = ok && w.bill ? w.bill : null;
  const billTone = bill && (bill.overdue > 0 || bill.n <= 1) ? L.alert : bill && bill.n <= 5 ? L.warn : L.ink2;

  if (sz === "tiny") {
    return (
      <FlexWidget {...open} style={{ ...root, padding: 8, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <TextWidget text="Safe to spend" adjustsFontSizeToFit style={{ fontSize: 9, color: L.ink2, fontFamily: FONT.medium }} maxLines={1} />
        {fig(Math.max(18, Math.min(26, W_ * 0.24)), true)}
        <TextWidget text={ok ? (hide ? "a day ₹••" : short(w.daily) + " a day") : "Money"} style={{ fontSize: 10.5, color: L.ink2, fontFamily: FONT.body }} maxLines={1} />
      </FlexWidget>
    );
  }
  if (sz === "strip") {
    return (
      <FlexWidget {...open} style={{ ...root, paddingHorizontal: 18, paddingVertical: 8, flexDirection: "row", alignItems: "center" }}>
        <FlexWidget style={{ flexDirection: "column", justifyContent: "center" }}>
          <TextWidget text={ok ? "Safe to spend · " + daily : msg} style={{ fontSize: 11.5, color: L.ink2, fontFamily: FONT.body }} maxLines={1} truncate="END" />
          {ok ? fig(Math.max(20, Math.min(30, H_ * 0.42)), W_ < 200) : null}
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: "column", alignItems: "flex-end", paddingHorizontal: 10 }}>
          {bill && W_ >= 300 ? <TextWidget text={bill.title} style={{ fontSize: 12, color: L.ink2, fontFamily: FONT.medium }} maxLines={1} truncate="END" /> : null}
          {bill && W_ >= 300 ? <TextWidget text={rupees(bill.amt, hide) + " · " + (bill.overdue > 0 ? "overdue" : bill.n === 0 ? "today" : bill.n === 1 ? "tomorrow" : dmon(bill.due))} style={{ fontSize: 12, color: billTone, fontFamily: FONT.body }} maxLines={1} /> : null}
        </FlexWidget>
        {W_ >= 230 ? <Btn_ glyph="+" action="OPEN_URI" uri="moneyrn://today?sheet=add" L={L} size={32} /> : null}
      </FlexWidget>
    );
  }
  if (sz === "tall") {
    const roomBill = H_ >= 170;
    return (
      <FlexWidget {...open} style={{ ...root, padding: 14, flexDirection: "column" }}>
        <TextWidget text="Safe to spend" style={{ fontSize: 12, color: L.ink2, fontFamily: FONT.medium }} maxLines={1} />
        {ok ? fig(W_ < 150 ? 26 : 32, W_ < 150) : <TextWidget text={msg} style={{ fontSize: 13, color: L.ink, fontFamily: FONT.body }} maxLines={3} />}
        {ok ? <TextWidget text={daily} style={{ fontSize: 12, color: L.ink2, fontFamily: FONT.body }} maxLines={1} /> : null}
        <FlexWidget style={{ flex: 1 }} />
        {roomBill && bill ? <TextWidget text={bill.title} style={{ fontSize: 12, color: L.ink, fontFamily: FONT.medium }} maxLines={1} truncate="END" /> : null}
        {roomBill && bill ? <TextWidget text={rupees(bill.amt, hide) + " · " + (bill.overdue > 0 ? "overdue" : bill.n === 0 ? "due today" : bill.n === 1 ? "tomorrow" : dmon(bill.due))} style={{ fontSize: 11.5, color: billTone, fontFamily: FONT.body }} maxLines={1} /> : null}
        {!roomBill && ok ? <TextWidget text={stamp} style={{ fontSize: 10.5, color: L.ink2, fontFamily: FONT.body }} maxLines={1} /> : null}
      </FlexWidget>
    );
  }
  // card and big: the header with ↻ and +, the figure, the balance line, then (big) today's numbers and what's coming
  const big = sz === "big";
  const curveH = big ? Math.max(34, Math.min(70, H_ * 0.17)) : H_ >= 150 ? 30 : 0;
  const svg = ok && !hide && curveH ? curveSvg(w.curve, L.ink, 600, Math.round((600 * curveH) / Math.max(120, W_ - 32))) : null;
  const rows = big ? Math.max(0, Math.min(6, Math.floor((H_ - 286) / 24))) : 0;
  const soon = ok && w.soon ? w.soon.slice(0, rows) : [];
  const Tile = (label, value, tone) => (
    <FlexWidget style={{ flex: 1, backgroundColor: L.tile, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "column" }}>
      <TextWidget text={label} style={{ fontSize: 10.5, color: L.ink2, fontFamily: FONT.body }} maxLines={1} />
      <TextWidget text={value} style={{ fontSize: 15, color: tone || L.ink, fontFamily: FONT.semi }} maxLines={1} />
    </FlexWidget>
  );
  return (
    <FlexWidget {...open} style={{ ...root, padding: 16, flexDirection: "column" }}>
      <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent" }}>
        <TextWidget text={"Safe to spend until payday" + (stamp ? " · " + stamp : "")} style={{ fontSize: 12.5, color: L.ink2, fontFamily: FONT.body, flex: 1 }} maxLines={1} truncate="END" />
        <Btn_ glyph="↻" action="REFRESH" L={L} />
        <Btn_ glyph="+" action="OPEN_URI" uri="moneyrn://today?sheet=add" L={L} />
      </FlexWidget>
      {ok ? (
        <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", width: "match_parent", marginTop: 2 }}>
          {fig(big ? 46 : W_ < 260 ? 32 : 38)}
          <TextWidget text={"  " + daily + (w.payday ? " · till " + dmon(w.payday) : "")} style={{ fontSize: 12.5, color: L.ink2, fontFamily: FONT.body, marginBottom: big ? 9 : 6 }} maxLines={1} truncate="END" />
        </FlexWidget>
      ) : <TextWidget text={msg} style={{ fontSize: 15, color: L.ink, fontFamily: FONT.medium, marginTop: 8 }} maxLines={2} />}
      {svg ? <SvgWidget svg={svg} style={{ height: curveH, width: "match_parent", marginTop: 6 }} /> : null}
      {big && ok ? (
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", marginTop: 10, flexGap: 6 }}>
          {Tile("Spent today", typeof w.spent === "number" ? rupees(w.spent, hide) : "—")}
          {Tile("A day", hide ? "₹••" : rupees(w.daily))}
          {Tile("Payday", w.payday ? dmon(w.payday) : "—")}
        </FlexWidget>
      ) : null}
      {soon.length ? (
        <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginTop: 10 }}>
          <TextWidget text="Coming up" style={{ fontSize: 11.5, color: L.ink2, fontFamily: FONT.semi, marginBottom: 2 }} />
          {soon.map((e, k) => (
            <FlexWidget key={k} style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height: 24 }}>
              <TextWidget text={whenN(e.n)} style={{ fontSize: 11.5, color: e.n <= 1 && e.dot === "bill" ? L.warn : L.ink2, fontFamily: FONT.body, width: 70 }} maxLines={1} />
              <FlexWidget style={{ flex: 1, paddingRight: 8 }}>
                <TextWidget text={e.title} style={{ fontSize: 12.5, color: L.ink, fontFamily: FONT.medium }} maxLines={1} truncate="END" />
              </FlexWidget>
              <TextWidget text={hide ? "₹••" : (e.amt > 0 ? "+" : "") + rupees(Math.abs(e.amt))} style={{ fontSize: 12.5, color: e.amt > 0 ? L.pos : L.ink, fontFamily: FONT.semi }} maxLines={1} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ flex: 1 }} />
      {!soon.length ? <TextWidget text={ok && bill ? billText(bill, hide) : ok ? w.line : ""} maxLines={1} truncate="END" style={{ fontSize: 12, color: bill ? billTone : L.ink2, fontFamily: FONT.body }} /> : null}
    </FlexWidget>
  );
}
/** Both widgets draw the same, laid out for their size ("Money" starts at 4×2, "Money: small" at 1×1). */
const draws = (name, w, info) => ({
  light: <MoneyWidget w={w} width={info.width} height={info.height} />,
  dark: <MoneyWidget w={w} dark width={info.width} height={info.height} />,
});

/** The Quick Settings tile's line: today's figure (hidden amounts stay hidden). */
function tile(w) {
  try {
    const { setTile } = require("../../modules/money-native/src");
    const ok = w && w.state === "ok";
    setTile(ok ? (w.hide ? "₹••••" : rupees(w.left)) : "Money", ok ? "safe to spend" : "open to see today");
  } catch (e) {}
}

/** Draw every placed widget again from what's stored. */
export async function redraw() {
  if (Platform.OS !== "android") return;
  const w = await readWidget();
  tile(w);
  for (const name of [WIDGET, SMALL]) { try { await requestWidgetUpdate({ widgetName: name, renderWidget: (info) => draws(name, w, info) }); } catch (e) {} }
}

/** The app's own numbers, while it's open (at most every 10 minutes when nothing changed). */
let lastKey = "", lastAt = 0, timer = null;
export function pushWidget(force) {
  if (Platform.OS !== "android") return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const { E, pref } = require("../store");
      if (!E.DATA_IN) return;
      const { tokens, mix } = require("../theme");
      const pal = pref.get("palette", "signal"), th = (d) => { const t = tokens(pal, d); return { a: mix(t.heroA, 0.9, "#FFFFFF"), b: t.heroB, ink: t.heroInk, ink2: t.heroInk2 }; };
      const w = Object.assign(E.widgetModel(), { hide: pref.get("hide", "0") === "1", src: "app", theme: { light: th(false), dark: th(true) } });
      const key = JSON.stringify(Object.assign({}, w, { at: 0 }));
      if (!force && key === lastKey && Date.now() - lastAt < 10 * 60000) return;
      lastKey = key; lastAt = Date.now();
      await writeWidget(w);
      await redraw();
    } catch (e) {}
  }, 600);
}
/** The server's numbers (background work). Not if the app's are newer; keeps the curve and your hide choice. */
export async function fromServer(server) {
  if (!server || !server.state) return;
  const old = await readWidget();
  if (old && old.at > server.at) return;
  if (old) {
    if (!server.curve && old.curve && server.state === "ok") server.curve = old.curve;
    if ("hide" in old) server.hide = old.hide;
    if (old.theme) server.theme = old.theme;
  }
  try {
    const { E } = require("../store"), S_ = require("./sms");
    if (server.state === "ok" && E.DATA_IN && S_.counting()) {
      const p = S_.pending(), net = p.reduce((a, x) => a + (x.dir === "out" ? x.amt : -x.amt), 0), was = server.left;
      server.left = Math.round(was - net);
      if (was > 0 && server.daily) server.daily = Math.round(server.daily * Math.max(0, server.left) / was);
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      server.spent = Math.round((server.spent || 0) + p.filter((x) => x.dir === "out" && x.ts >= d0.getTime()).reduce((a, x) => a + x.amt, 0));
    }
  } catch (e) {}
  server.src = "server";
  await writeWidget(server);
  await redraw();
}
export async function clearWidget() { await AsyncStorage.removeItem(KEY).catch(() => {}); await redraw(); }

/** What Android asks of the widget (added, resized, every 30 minutes, ↻ tapped). */
export async function widgetTaskHandler(props) {
  const draw = async () => { const w = await readWidget(); props.renderWidget(draws(props.widgetInfo.widgetName, w, props.widgetInfo)); };
  if (props.widgetAction === "WIDGET_DELETED") return;
  if (props.widgetAction === "WIDGET_CLICK" && props.clickAction === "REFRESH") {
    refreshing = true; await draw();
    try { const { syncNow } = require("./background"); await syncNow(); } catch (e) {}
    refreshing = false;
  }
  await draw();
}

/** Ask the home screen to add the widget (Android shows its own "Add to home screen" prompt). */
export async function pinWidget(name) {
  if (Platform.OS !== "android" || !W.requestPinWidget) return false;
  try { return await W.requestPinWidget({ widgetName: name || WIDGET }); } catch (e) { return false; }
}

/* A gallery of the widget at every size (the demo build opens it with moneyrn://today?fx=widgets, so the emulator
   check can see each layout without a home screen). */
let showGallery = null;
export function openGallery() { if (showGallery) showGallery(true); }
export function WidgetGallery() {
  const { useEffect, useState } = React;
  const [on, setOn] = useState(false), [w, setW] = useState(null);
  useEffect(() => { showGallery = (v) => { setOn(v); readWidget().then(setW); }; return () => { showGallery = null; }; }, []);
  if (!on || Platform.OS !== "android") return null;
  const { ScrollView, View, Text, Pressable } = require("react-native");
  const sizes = [["1×1", 70, 70], ["4×1", 320, 80], ["2×2", 150, 170], ["4×2", 320, 170], ["4×3", 320, 270], ["4×4", 320, 380]];
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 90, backgroundColor: "#8C8C88" }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, gap: 14, alignItems: "flex-start" }}>
        <Pressable onPress={() => setOn(false)}><Text style={{ color: "#fff", fontSize: 16 }}>Close</Text></Pressable>
        {sizes.map(([n, wd, ht]) => (
          <View key={n} style={{ gap: 4 }}>
            <Text style={{ color: "#fff", fontSize: 12 }}>{n + " (" + wd + "×" + ht + " dp)"}</Text>
            <W.WidgetPreview width={wd} height={ht} renderWidget={() => <MoneyWidget w={w} width={wd} height={ht} />} />
          </View>
        ))}
        <W.WidgetPreview width={320} height={170} renderWidget={() => <MoneyWidget w={w} dark width={320} height={170} />} />
      </ScrollView>
    </View>
  );
}
