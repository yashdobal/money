/* Money RN · the building blocks, sized and coloured exactly as the Money app's stylesheet (app/app.css): text,
   amounts, panels, rows, tiles, chips, segmented choices, switches, buttons, badges, bars, and the motion they share
   (panels rising in, figures rolling and counting, presses springing back). */
import React, { useContext, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { E, pref } from "./store";
import { useC, F, mix, track, ThemeCtx, darkCard } from "./theme";
import { Sheen, SheenFill, Bob, BobCtx, Glow, Tick } from "./alive";
import { haptic, WIDE } from "./host";
import { Icon } from "./icons";
import { S, springTo, timeTo, enter, motionOn, outExpo, NATIVE, EASE_OUT, rs } from "./motion";
import RAnimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolateColor } from "react-native-reanimated";

/* ---------------- money, written the same way everywhere ---------------- */
export const rup = (v) => "₹" + Math.round(Math.abs(v)).toLocaleString("en-IN");
export const exact = (v) => (Math.round(Math.abs(v) * 100) % 100 ? "₹" + Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : rup(v));
export function compact(n) {
  const v = Math.abs(n), s = n < 0 ? "−" : "";
  if (v < 1000) return s + "₹" + Math.round(v);
  if (v < 1e5) { const k = v / 1000; return s + "₹" + (k < 10 ? Math.round(k * 10) / 10 : Math.round(k)) + "k"; }
  const L = v / 1e5; return s + "₹" + (L < 10 ? Math.round(L * 100) / 100 : Math.round(L * 10) / 10) + "L";
}
export const hidden = () => pref.get("hide", "0") === "1";
/** An amount as text. sign: "out" (−), "in" (+), "plus" (+/−), default − only when negative. */
export function amt(n, o) {
  o = o || {};
  const v = Math.abs(n || 0), body = o.exact ? exact(v) : rup(v);
  let sign = "";
  if (o.sign === "out") sign = v >= 0.5 ? "−" : "";
  else if (o.sign === "in") sign = v >= 0.5 ? "+" : "";
  else if (o.sign === "plus") sign = n < 0 && v >= 0.5 ? "−" : v >= 0.5 ? "+" : "";
  else sign = n < 0 && v >= 0.5 ? "−" : "";
  return sign + body;
}
export const money = (n) => E.money(n);
export const toneColor = (C, tone) => (tone === "pos" ? C.pos : tone === "alert" ? C.alert : tone === "warn" ? C.warn : tone === "info" ? C.info : tone === "soft" ? C.ink3 : C.ink);

/** A payee as a title: "AMAZON WEB SERVICES (USD 24.85 at Rs 86.44)" → "Amazon Web Services", extra "USD 24.85 at ₹86.44". */
export function nice(desc) {
  let t = String(desc || "").trim().replace(/^(NEFT|IMPS|RTGS)(\s+(CR|DR))?[\s\-\/:]+/i, ""), extra = "";
  const m = t.match(/^(.*?)\s*\(([A-Z]{3})\s+([\d.,]+)\s+at\s+Rs\.?\s*([\d.,]+)\)\s*$/i);
  if (m) { t = m[1]; extra = m[2].toUpperCase() + " " + m[3] + " at ₹" + m[4]; }
  if (t.length > 4 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) t = t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return { title: t || String(desc || ""), extra };
}
export const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
export const dayName = (d) => { const n = E.days(E.sod(new Date()), d); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : E.fmtD(d); };
export const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? plural(-n, "day") + " ago" : "in " + plural(n, "day"));
export const acctShort = (x) => { if (x.card) return E.cardShort(x.card); const b = E.bankOf({ account: x.account }); return b ? b.name : x.account; };
export const cap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());

/* category colours (muted, so the donut can tell them apart without the screen turning colourful) */
export const CAT_C = {
  "Food & dining": "#B08968", Groceries: "#7F9C7A", Travel: "#7A93A8", Shopping: "#A88595", "Bills & subscriptions": "#8A86A8",
  Entertainment: "#9A8AAE", Health: "#7FA3A0", "Transfers to people": "#A08F80", Investments: "#7E9A8E", "Cash & transfers": "#8F8F94",
  "Card payment": "#8F8F94", "Moved to goals": "#7A93A8", "Planned payment": "#A08F80", "Money in": "#6F9A82", Refunds: "#6F9A82",
  "Paid back": "#6F9A82", Salary: "#6F9A82", "Other income": "#6F9A82", "UPI — payee unknown": "#9A9A9A", Other: "#9A9A9A",
};
export const catHue = (c) => CAT_C[c] || "#9A9A9A";
const ICON_OF = { Salary: "salary", "Other income": "Money in" };

/* ---------------- haptics ---------------- */
export function buzz(kind) {
  if (pref.get("haptics", "1") === "0") return;
  if (Platform.OS === "web") { haptic(kind); return; }   // the Android app's own haptics, or the browser's vibration
  try {
    if (kind === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (kind === "confirm") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "heavy") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.selectionAsync();
  } catch (e) {}
}

/* ---------------- text ---------------- */
/** What stands in for an amount while amounts are hidden. The digits are never drawn: a blurred or see-through
    number can still be read on some phones (Android drew the "transparent" digits in black). */
export const MASK = "₹ ••••";
const AMT_RE = /₹\s?\d/, AMT_ALL = /[−+-]?₹\s?[\d,]+(?:\.\d+)?[kKLl]?/g;
/** Text in Anek, with tabular digits. f: a font cut (theme F), s: size, c: colour. */
export function T({ f, s = 15, lh, c, style, children, lines, ...rest }) {
  const C = useC();
  const col = c || C.ink;
  // amounts inside a line ("₹475 a day") are masked too when amounts are hidden; the words stay
  if (hidden() && (typeof children === "string" || (Array.isArray(children) && children.every((x) => typeof x === "string" || typeof x === "number")))) {
    const str = Array.isArray(children) ? children.join("") : children;
    if (AMT_RE.test(str)) children = str.replace(AMT_ALL, MASK);
  }
  return <Text numberOfLines={lines} {...rest} style={[{ fontFamily: f || F.body, fontSize: s, lineHeight: lh || Math.round(s * 1.42), color: col, letterSpacing: track(s), fontVariant: ["tabular-nums"], includeFontPadding: false }, style]}>{children}</Text>;
}
/** An amount. While amounts are hidden it is the mask, in the amount's own colour; anything without a digit (a dash)
    shows as it is. */
export function M({ v, o, f = F.semi, s = 15, c, tone, style, lines = 1, text }) {
  const C = useC();
  const col = c || toneColor(C, tone);
  const t = text !== undefined ? text : amt(v, o);
  return <T f={f} s={s} c={col} lines={lines} style={style}>{hidden() && /\d/.test(String(t)) ? MASK : t}</T>;
}

/* ---------------- presses: scale down and spring back (app.css .press) ---------------- */
export function Press({ onPress, style, children, scale = 0.97, disabled, haptic = true, onPressIn, onPressOut, accessibilityLabel, accessibilityRole, hitSlop, onLayout, wash }) {
  const v = useRef(new Animated.Value(1)).current;
  const C = useC();
  const [down, setDown] = useState(false);
  const flat = StyleSheet.flatten(style) || {};
  const outer = {}, inner = {};
  // margins and position stay outside the part that scales
  Object.keys(flat).forEach((k) => { (/^(margin|position|left|right|top|bottom|flex$|flexGrow|flexShrink|flexBasis|alignSelf|width$|zIndex)/.test(k) ? outer : inner)[k] = flat[k]; });
  return (
    <Pressable disabled={disabled} accessibilityRole={accessibilityRole || "button"} accessibilityLabel={accessibilityLabel} hitSlop={hitSlop} onLayout={onLayout}
      onPressIn={(e) => { if (wash) setDown(true); if (scale !== 1) timeTo(v, scale, 70).start(); onPressIn && onPressIn(e); }}
      onPressOut={(e) => { if (wash) setDown(false); if (scale !== 1) springTo(v, 1, S.press).start(); onPressOut && onPressOut(e); }}
      onPress={(e) => { if (haptic) buzz("tick"); onPress && onPress(e); }} style={outer}>
      <Animated.View style={[inner, { transform: [{ scale: v }] }, wash && down && { backgroundColor: C.inset }, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ---------------- motion: blocks rise in turn when a screen opens ---------------- */
/** A block of a screen: springs up from a little smaller at its turn (48 ms apart), with a touch of overshoot; on the
    first visit from further down and smaller (choreo.js rise). */
export function Rise({ i = 0, first = true, hero, children, style, delay }) {
  const on = motionOn();
  const v = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    const d = (delay !== undefined ? delay : first ? 40 : 0) + Math.min(i, 9) * 48;
    enter(v, S.block, { delay: d });
  }, []);
  const dy = hero ? 8 : first ? 16 : 10, sc = hero ? 0.93 : first ? 0.88 : 0.94;
  return (
    <Animated.View style={[style, on && { opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [sc, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}
/** When a block at position i has finished arriving (for its figures and charts to start). */
export const settleAt = (i, first) => (motionOn() ? (first ? 40 : 0) + Math.min(i, 9) * 48 + 260 : 0);

/** A figure that counts up from ₹0 (the first time its screen opens; outExpo, 1 s). */
export function CountUp({ v, o, f, s, c, tone, delay = 0, run = true, style }) {
  const go = run && motionOn() && !hidden() && Math.abs(v) >= 1;
  const [shown, setShown] = useState(go ? 0 : v);
  useEffect(() => {
    if (!go) { setShown(v); return; }
    let raf, t0;
    const tm = setTimeout(() => {
      t0 = Date.now();
      const step = () => { const k = Math.min(1, (Date.now() - t0) / 1000); setShown(v * outExpo(k)); if (k < 1) raf = requestAnimationFrame(step); else setShown(v); };
      raf = requestAnimationFrame(step);
    }, delay + 80);
    return () => { clearTimeout(tm); cancelAnimationFrame(raf); };
  }, [v]);
  return <M v={shown} o={o} f={f} s={s} c={c} tone={tone} style={style} />;
}

/** The big figure that rolls like an odometer, digit by digit (app.css .odo: 1 s, the soft spring, 45 ms apart). */
/** delay/dur: roll in step with something else (the hero's line draws over the same 1250 ms, on the same curve). */
export function Odo({ value, f = F.hero, s = 54, c, letterSpacing, run = true, delay, dur }) {
  const C = useC();
  if (letterSpacing === undefined) letterSpacing = track(s);
  const col = c || C.ink;
  const text = rup(value), lh = Math.round(s * 1.08);
  if (hidden()) return <M text={text} f={f} s={s} c={col} style={{ lineHeight: lh, letterSpacing }} />;
  const chars = [...text];
  let di = 0;
  return (
    <View style={{ flexDirection: "row" }} accessible accessibilityLabel={text}>
      {chars.map((ch, i) => /\d/.test(ch)
        ? <Digit key={i + "-" + chars.length} n={+ch} k={di++} f={f} s={s} lh={lh} c={col} ls={letterSpacing} run={run} delay={delay} dur={dur} />
        : <Text key={i} style={{ fontFamily: f, fontSize: s, lineHeight: lh, color: col, letterSpacing, includeFontPadding: false }}>{ch}</Text>)}
    </View>
  );
}
const inOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
function Digit({ n, k, f, s, lh, c, ls, run, delay, dur }) {
  const go = run && motionOn();
  const v = useRef(new Animated.Value(go ? 0 : n)).current;
  useEffect(() => {
    if (!go) { v.setValue(n); return; }
    Animated.timing(v, dur ? { toValue: n, duration: Math.max(400, dur - k * 40), easing: inOutQuart, delay: (delay || 0) + k * 40, useNativeDriver: NATIVE }
      : { toValue: n, duration: 1000, easing: S.soft.ease, delay: 120 + k * 45, useNativeDriver: NATIVE }).start();
  }, [n]);
  return (
    <View style={{ height: lh, overflow: "hidden" }}>
      <Tick k={k} lh={lh}>
        <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 9], outputRange: [0, -9 * lh] }) }] }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <Text key={d} style={{ fontFamily: f, fontSize: s, lineHeight: lh, height: lh, color: c, letterSpacing: ls, includeFontPadding: false }}>{d}</Text>)}
        </Animated.View>
      </Tick>
    </View>
  );
}

/* ---------------- a screen's page ---------------- */
/** A wide window (a laptop): the sidebar, and a screen's blocks side by side. */
export const useWide = () => useWindowDimensions().width >= WIDE;
/** On a block of a Page: cross both columns (a row of chips above everything). */
export const SPAN = Platform.OS === "web" ? { columnSpan: "all" } : null;
/** A screen's blocks, one under another. In a wide browser window they flow into two balanced columns instead (the
    browser's own multi-column layout; rn/web/head.html keeps each block whole). one: stay a single, narrower column
    (a list reads better that way). */
export function Page({ id, children, one, style }) {
  const wide = useWide();
  if (!wide || Platform.OS !== "web") return <View style={style}>{children}</View>;
  if (one) return <View style={[{ maxWidth: 760, width: "100%", alignSelf: "center" }, style]}>{children}</View>;
  return <View nativeID={"cols-" + id} style={[{ display: "block", columnCount: 2, columnGap: 16 }, style]}>{children}</View>;
}

/* ---------------- panels, rows, tiles ---------------- */
/** What a row, tile or control is sitting in: "tray" (a grey tray: rows and tiles are white cards), "w" (a white card
    or a sheet: rows are lines, tiles sink into grey), "d" (a dark card), or null (the page itself). */
export const TrayCtx = React.createContext(null);
export const useTray = () => useContext(TrayCtx);
/** A white card's look: 14 px corners and the soft two-layer shadow. */
export const cardLook = (C) => ({ borderRadius: 14, backgroundColor: C.surface, boxShadow: C.card });
/** .panel: a grey tray (22 px corners, 12 px padding) whose rows and tiles are white cards. kind "w": one white card
    itself (charts, forms); "d": a dark card, like the hero. .ph: the title row (16 px). */
export function Panel({ title, info, onInfo, right, children, style, tone, i, first, kind }) {
  const C = useC();
  const k = tone ? "w" : kind || "tray";
  const D = k === "d" ? darkCard(C) : C;
  const box = k === "tray" ? { backgroundColor: C.tray, padding: 12 }
    : k === "d" ? { backgroundColor: C.heroA, padding: 18, paddingBottom: 16, boxShadow: C.face }
    : { backgroundColor: tone === "warn" ? C.warnSoft : tone === "alert" ? C.alertSoft : C.surface, padding: 16, paddingBottom: 14, boxShadow: tone ? undefined : C.card };
  const body = (
    <View style={[{ borderRadius: 22, marginBottom: 10 }, box, style]}>
      <ThemeCtx.Provider value={D}>
        <TrayCtx.Provider value={k}>
          {title || right ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, minHeight: 28, gap: 8, paddingHorizontal: k === "tray" ? 6 : 0 }}>
              <T f={F.head} s={16} lh={21} c={D.ink} style={{ flexShrink: 1 }} accessibilityRole="header">{title}</T>
              {info ? <IB name="info" onPress={onInfo} label={"About " + title} /> : null}
              <View style={{ flex: 1 }} />
              {right}
            </View>
          ) : null}
          {children}
        </TrayCtx.Provider>
      </ThemeCtx.Provider>
    </View>
  );
  return i === undefined ? body : <Rise i={i} first={first}>{body}</Rise>;
}
/** A tray for things that aren't in a panel (two tiles side by side on the page). */
export function Tray({ children, style, row }) {
  const C = useC();
  return <View style={[{ borderRadius: 22, padding: 10, backgroundColor: C.tray, marginBottom: 10 }, row && { flexDirection: "row", gap: 10 }, style]}><TrayCtx.Provider value="tray">{children}</TrayCtx.Provider></View>;
}
/** A white card inside a tray, for anything that isn't a plain row (a goal, a loan). What's inside is on white. */
export function Card({ children, style, first }) {
  const C = useC();
  return <View style={[cardLook(C), { padding: 12, marginTop: first ? 0 : 6 }, style]}><TrayCtx.Provider value="w">{children}</TrayCtx.Provider></View>;
}
/** .ib: a small round icon button (30 px, ink-3). */
export function IB({ name, onPress, label, color, size = 19 }) {
  const C = useC();
  return <Press onPress={onPress} accessibilityLabel={label} scale={0.9} style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginVertical: -4 }}><Icon name={name} size={size} color={color || C.ink3} /></Press>;
}
/** .x: remove (32 px). */
export function XBtn({ onPress, label }) {
  const C = useC();
  return <Press onPress={onPress} accessibilityLabel={label} scale={0.9} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: -6, marginLeft: 4 }}><Icon name="close" size={16} color={C.ink3} /></Press>;
}

/** .rows: in a tray, each row is a white card (the first six rows' icons bob, one after another); on white, rows with
    a line between them (none above the first, or right under a day heading). ledger: one white card of lines. */
export function Rows({ children, style, ledger }) {
  const C = useC();
  const tray = useTray() === "tray";
  let prevHead = true, n = 0;
  const kids = [];
  React.Children.forEach(children, (ch, idx) => {
    if (!ch) return;
    const isHead = ch.type === DayHead;
    kids.push(isHead ? React.cloneElement(ch, { key: ch.key || "h" + idx, first: kids.length === 0 })
      : <BobCtx.Provider key={ch.key || "r" + idx} value={n < 6 ? n : -1}>{React.cloneElement(ch, { first: prevHead, ledger })}</BobCtx.Provider>);
    if (!isHead) n++;
    prevHead = isHead;
  });
  if (ledger && tray) return <View style={[cardLook(C), { paddingHorizontal: 12, paddingVertical: 2 }, style]}><TrayCtx.Provider value="w">{kids}</TrayCtx.Provider></View>;
  return <View style={style}>{kids}</View>;
}
/** .r: an icon, a title of at most 2 lines with one line of detail, and an amount that never wraps. */
export function Row({ icon, title, detail, value, sub, tone, onPress, soft, uncounted, after, chevron, total, first, ledger, right, titleSize, plain }) {
  const C = useC();
  const card = useTray() === "tray" && !plain;
  const valCol = soft ? C.ink3 : uncounted ? C.ink3 : toneColor(C, tone);
  const inner = (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ledger ? 50 : 58, paddingVertical: 10 },
      card ? null : { borderTopWidth: first ? 0 : total ? 1.5 : 1, borderTopColor: total && !first ? C.ink : C.line }]}>
      {icon || null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T f={total ? F.bold : F.medium} s={titleSize || 14.5} lh={19.5} c={soft ? C.ink2 : C.ink} lines={2}>{title}</T>
        {detail ? <T s={12.5} lh={17} c={C.ink3} lines={1}>{detail}</T> : null}
      </View>
      {value !== undefined && value !== null ? (
        <View style={{ alignItems: "flex-end", maxWidth: "58%" }}>
          <M text={value} f={total ? F.bold : F.semi} s={15} c={soft && !tone ? C.ink2 : valCol} />
          {sub ? <T s={12} lh={16} c={C.ink3} lines={1} style={{ marginTop: 2 }}>{sub}</T> : null}
        </View>
      ) : right || null}
      {chevron ? <Icon name="chev" size={18} color={C.ink3} /> : null}
      {after || null}
    </View>
  );
  const look = card ? [cardLook(C), { paddingHorizontal: 12, marginTop: first ? 0 : 6 }] : null;
  if (!onPress) return card ? <View style={look}>{inner}</View> : inner;
  return card ? <Press onPress={onPress} scale={0.985} wash style={look}>{inner}</Press>
    : <Press onPress={onPress} scale={1} wash style={{ marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 12 }}>{inner}</Press>;
}
/** .ic: the 38 px rounded square at the start of a row. tone: a meaning colour (alert, warn, info); else the theme's.
    Its icon bobs when its row is one of the first six in a tray (alive.js). */
export function Ic({ name, color, tone, size = 38, radius = 11, iconSize = 20 }) {
  const C = useC();
  const k = useContext(BobCtx);
  let fg, bg;
  if (color) { fg = color; bg = mix(color, C.dark ? 0.2 : 0.13, C.surface); }
  else if (tone) { fg = tone === "alert" ? C.alert : tone === "warn" ? C.warn : tone === "info" ? C.info : C.ink2; bg = mix(fg, C.dark ? 0.2 : 0.13, C.surface); }
  else if (C.icTint) { fg = C.accent; bg = C.accentSoft; }
  else { fg = C.ink2; bg = C.inset; }
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Bob k={k} on={k >= 0}><Icon name={name} size={iconSize} color={fg} /></Bob></View>;
}
export const CatIc = ({ cat, size, radius, iconSize }) => <Ic name={ICON_OF[cat] || cat} size={size} radius={radius} iconSize={iconSize} />;
/** .dot-ic: money in, a card bill, money you send, a statement closing (outlined). */
export function DotIc({ kind }) {
  const C = useC();
  if (kind === "stmt") return <View style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1.5, borderColor: C.line2, alignItems: "center", justifyContent: "center" }}><Icon name="calendar" size={18} color={C.ink3} /></View>;
  const fg = kind === "in" ? C.pos : kind === "bill" ? C.alert : C.ink2;
  return <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: mix(fg, C.dark ? 0.2 : 0.13, C.surface), alignItems: "center", justifyContent: "center" }}><Icon name={kind === "in" ? "arrowIn" : kind === "out" ? "arrowOut" : "card"} size={18} color={fg} /></View>;
}
/** .sw: a 12 px colour square. */
export const Sw = ({ c, size = 12, style }) => <View style={[{ width: size, height: size, borderRadius: 4, backgroundColor: c }, style]} />;

/** .tile: a white card in a tray or on the page; on a white card or a sheet it sinks into grey; on a dark card, a
    lighter patch. A band of light crosses it now and then (alive.js). */
export function Tile({ label, value, sub, onPress, tone, inPanel, three, countV, countRun, delay }) {
  const C = useC();
  const tray = useTray();
  const lift = tray === "tray" || (tray === null && !inPanel);
  const inner = (
    <View style={{ gap: 3, paddingTop: 13, paddingHorizontal: 13, paddingBottom: 12 }}>
      <T f={F.medium} s={12} lh={16} c={C.ink2} lines={1} style={{ letterSpacing: 0 }}>{label}</T>
      {countV !== undefined ? <CountUp v={countV} f={F.tile} s={three ? 16 : 19} tone={tone} run={countRun} delay={delay} />
        : <M text={value} f={F.tile} s={three ? 16 : 19} tone={tone} />}
      {sub ? <T s={11.5} lh={15} c={C.ink3} lines={1}>{sub}</T> : null}
      <SheenFill tone={C.onDark ? "#FFFFFF" : C.accent} strength={C.onDark ? 0.1 : 0.09} every={6400} radius={14} id="t" />
    </View>
  );
  const box = [{ flex: 1, minWidth: 0, borderRadius: 14, backgroundColor: lift ? C.surface : tray === "d" ? C.heroTile : C.inset }, lift && { boxShadow: C.card }];
  return onPress ? <Press onPress={onPress} style={box} scale={0.97}>{inner}</Press> : <View style={box}>{inner}</View>;
}
export const Gap = ({ h = 12, w }) => <View style={{ height: w ? undefined : h, width: w }} />;
/** .sub-h: 14 px, semibold; small: the grey note after it. */
export function SubHead({ children, small, right, style }) {
  const C = useC();
  return (
    <View style={[{ flexDirection: "row", alignItems: "baseline", marginTop: 22, marginBottom: 8, gap: 4 }, style]}>
      <T f={F.day} s={14} lh={19} style={{ flexShrink: 1 }}>{children}{small ? <T s={13} c={C.ink3}>{"  " + small}</T> : null}</T>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}
/** .note / .muted */
export function Note({ children, style, tone, s = 13.5 }) {
  const C = useC();
  const tray = useTray() === "tray";                 // on a tray, text lines up with the cards' insides
  return <T s={s} lh={Math.round(s * 1.45)} c={tone ? toneColor(C, tone) : C.ink3} style={[{ marginTop: 2, marginBottom: 10 }, tray && { paddingHorizontal: 6 }, style]}>{children}</T>;
}
/** .badge */
export function Badge({ text, tone }) {
  const C = useC();
  const bg = tone === "pos" ? C.posSoft : tone === "alert" ? C.alertSoft : tone === "warn" ? C.warnSoft : C.inset;
  const fg = tone === "pos" ? C.pos : tone === "alert" ? C.alert : tone === "warn" ? C.warn : C.ink2;
  const b = <View style={{ height: 22, paddingHorizontal: 9, borderRadius: 11, backgroundColor: bg, justifyContent: "center" }}><T f={F.semi} s={11.5} lh={14} c={fg} style={{ letterSpacing: 0 }}>{text}</T></View>;
  return tone === "alert" || tone === "warn" ? <Glow>{b}</Glow> : b;
}
/** .day-h */
export function DayHead({ left, right, first }) {
  const C = useC();
  const tray = useTray() === "tray";
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingTop: first ? (tray ? 2 : 4) : tray ? 12 : 16, paddingBottom: tray ? 6 : 4, paddingHorizontal: tray ? 6 : 0 }}>
      <T f={F.day} s={13} lh={18} lines={1} style={{ flexShrink: 1 }}>{left}</T>
      {right ? (typeof right === "string" ? <T s={12.5} lh={16} c={C.ink3}>{right}</T> : right) : null}
    </View>
  );
}
/** .bar: grows from the left on a spring. */
export function Bar({ pct, color, height = 6, delay = 0, style }) {
  const C = useC();
  const p = Math.max(0, Math.min(100, pct || 0));
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  const [w, setW] = useState(0);
  useEffect(() => { if (motionOn()) enter(v, S.grow, { delay: 80 + delay }); }, []);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[{ height, borderRadius: height / 2, backgroundColor: C.inset2, overflow: "hidden" }, style]}>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (w * p) / 100, borderRadius: height / 2, backgroundColor: color || C.accent, overflow: "hidden",
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-(w * p) / 200, 0] }) }, { scaleX: v }] }}>
        <Sheen w={(w * p) / 100} h={height} strength={0.6} delay={delay} id="b" />
      </Animated.View>
    </View>
  );
}
/** .split-bar: the salary's parts, one after another growing in. */
export function SplitBar({ parts, delay = 0, style }) {
  const base = parts.reduce((a, x) => a + Math.max(0, x[1]), 0) || 1;
  return (
    <View style={[{ flexDirection: "row", gap: 3, height: 12, marginTop: 6, marginBottom: 10, borderRadius: 6, overflow: "hidden" }, style]}>
      {parts.map((x, j) => <SplitPart key={x[0] + j} flex={Math.max(0, x[1]) / base} c={x[2]} delay={delay + j * 90} />)}
    </View>
  );
}
function SplitPart({ flex, c, delay }) {
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  const [w, setW] = useState(0);
  useEffect(() => { if (motionOn()) enter(v, S.grow, { delay: 80 + delay }); }, []);
  return <Animated.View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flex, minWidth: 4, borderRadius: 3, backgroundColor: c, overflow: "hidden",
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-w / 2, 0] }) }, { scaleX: v }] }}><Sheen w={w} h={12} strength={0.6} delay={delay * 2} id="s" /></Animated.View>;
}
/** .legend */
export function Legend({ items, small, style }) {
  const C = useC();
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", columnGap: small ? 10 : 14, rowGap: small ? 4 : 6 }, style]}>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {x[3] === "dash" ? <View style={{ width: 14, borderTopWidth: 1.6, borderStyle: "dashed", borderColor: x[1] }} /> : <View style={{ width: small ? 6 : 12, height: small ? 6 : 12, borderRadius: small ? 3 : 4, backgroundColor: x[1] }} />}
          <T s={small ? 12 : 13} lh={17} c={small ? C.ink3 : C.ink2}>{x[0]}{x[2] ? <T f={F.semi} s={13} c={C.ink}>{" " + x[2]}</T> : null}</T>
        </View>
      ))}
    </View>
  );
}

/* ---------------- controls ---------------- */
/** button.solid (accent, 44 px; pressed: squeezes and its corners tighten), .ghost (a white pill in a tray, a grey one
    on white), .small, .linkbtn */
export function Btn({ label, onPress, kind = "solid", small, big, icon, danger, disabled, style, full, accessibilityLabel, bg: bgO, fg: fgO }) {
  const C = useC();
  const tray = useTray();
  const r = useRef(new Animated.Value(0)).current;
  if (kind === "link") return (
    <Press onPress={onPress} scale={0.96} disabled={disabled} style={style} accessibilityLabel={accessibilityLabel}>
      <T f={F.semi} s={small ? 13.5 : 14.5} lh={20} c={disabled ? C.ink3 : C.accent}>{label}</T>
    </Press>
  );
  const solid = kind === "solid", h = big ? 52 : small ? 36 : 44;
  const lift = !solid && (tray === "tray" || tray === null);
  const bg = bgO || (solid ? C.accent : lift ? C.surface : C.inset), fg = fgO || (solid ? C.accentInk : danger ? C.alert : C.ink);
  return (
    <Press onPress={onPress} disabled={disabled} scale={solid ? 0.955 : 0.97} accessibilityLabel={accessibilityLabel || label}
      onPressIn={() => solid && timeTo(r, 1, 90, null, { native: false }).start()} onPressOut={() => solid && springTo(r, 0, S.small, { native: false }).start()}
      style={[{ alignSelf: full ? "stretch" : "flex-start" }, style, full && { flex: 1 }]}>
      <Animated.View style={{ minHeight: h, paddingHorizontal: small ? 14 : 18, borderRadius: solid ? r.interpolate({ inputRange: [0, 1], outputRange: [26, 14] }) : 999,
        backgroundColor: bg, boxShadow: lift && !bgO ? C.card : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {icon ? <Icon name={icon} size={18} color={fg} sw={2.2} /> : null}
        <T f={F.semi} s={big ? 15.5 : small ? 13.5 : 14.5} lh={20} c={fg} lines={1}>{label}</T>
      </Animated.View>
    </Press>
  );
}
/** .add-row: a dashed row that adds something. */
export function AddRow({ label, onPress }) {
  const C = useC();
  return (
    <Press onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, marginTop: 12, paddingHorizontal: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.line2, borderRadius: 14 }}>
      <Icon name="plus" size={20} color={C.accent} /><T f={F.medium} s={15} c={C.accent}>{label}</T>
    </Press>
  );
}
/** A spring "pop" when chosen (choreo.js: a chip, swatch or segment you pick). */
function usePop() {
  const v = useRef(new Animated.Value(1)).current;
  return [v, () => { if (!motionOn()) return; v.setValue(0.9); springTo(v, 1, S.pop).start(); }];
}
/** .chip */
export function Chip({ label, on, onPress, icon, iconColor, small, removable, dashed, accessibilityLabel }) {
  const C = useC();
  const [pop, go] = usePop();
  const tray = useTray();
  const lift = !on && !dashed && (tray === "tray" || tray === null);     // a white pill on grey; on white, a grey one
  const fg = on ? (C.onDark ? "#141416" : C.surface) : dashed ? C.ink3 : C.ink2;
  return (
    <Press onPress={() => { go(); onPress && onPress(); }} scale={0.95} accessibilityRole="radio" accessibilityLabel={accessibilityLabel || label}>
      <Animated.View style={{ transform: [{ scale: pop }], flexDirection: "row", alignItems: "center", gap: 6, height: small ? 34 : 36, paddingHorizontal: small ? 12 : 14, borderRadius: 18,
        borderWidth: dashed ? 1 : 0, borderStyle: dashed ? "dashed" : "solid", borderColor: C.line2, backgroundColor: on ? C.ink : dashed ? "transparent" : lift ? C.surface : C.inset,
        boxShadow: lift ? C.card : undefined }}>
        {icon ? <Icon name={icon} size={16} color={on ? fg : iconColor || fg} /> : null}
        <T f={F.medium} s={small ? 13 : 13.5} lh={18} c={fg}>{label}</T>
        {removable ? <Icon name="close" size={14} color={fg} /> : null}
      </Animated.View>
    </Press>
  );
}
/** .chips (wrapping, or a row that scrolls sideways) of single choices. options: [[value, label, icon?, iconColor?]] */
/** Run the heavy part of a tap on the next frame, after its feedback (the highlight, the tick) is already on screen. */
export const later = (fn) => requestAnimationFrame(() => fn());

export function Chips({ options, value, onChange, scroll, small, style }) {
  // the chip you tap lights up at once; the list behind it updates a frame later
  const [sel, setSel] = useState(value);
  useEffect(() => { setSel(value); }, [value]);
  const chips = options.map(([v, l, icon, ic]) => <Chip key={v} label={l} on={v === sel} icon={icon} iconColor={ic} small={small} onPress={() => { setSel(v); later(() => onChange(v)); }} />);
  if (scroll) return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ marginHorizontal: -16 }, style]} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 }}>{chips}</ScrollView>;
  return <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: 8 }, style]}>{chips}</View>;
}
/** .seg: segmented choices; the highlight stretches across to the one you pick, the moment you touch it (on the
    graphics thread): its leading edge goes first and the trailing edge catches up. What it changes follows a frame later. */
export function Seg({ options, value, onChange, full, style, label }) {
  const C = useC();
  const tray = useTray();
  const lay = useRef({}).current;
  const l = useSharedValue(0), r = useSharedValue(0);
  const [sel, setSel] = useState(value);
  const selRef = useRef(value);
  const [ready, setReady] = useState(false);
  const place = (v, animate) => {
    const L = lay[v]; if (!L) return;
    const from = lay[selRef.current], right = !from || L.x >= from.x;
    selRef.current = v;
    if (animate && motionOn()) { l.value = withSpring(L.x, rs(right ? S.trail : S.lead)); r.value = withSpring(L.x + L.w, rs(right ? S.lead : S.trail)); }
    else { l.value = L.x; r.value = L.x + L.w; }
  };
  useEffect(() => { if (value !== sel) { setSel(value); place(value, ready); } }, [value]);
  const hl = useAnimatedStyle(() => ({ left: l.value, width: Math.max(0, r.value - l.value) }));
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[{ flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: tray === "tray" ? C.inset2 : C.inset, alignSelf: full ? "stretch" : "flex-start" }, style]}>
      <RAnimated.View style={[{ position: "absolute", top: 3, bottom: 3, borderRadius: 9, backgroundColor: C.surface,
        shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1, opacity: ready ? 1 : 0 }, hl]} />
      {options.map(([v, l]) => (
        <Press key={v} haptic={false} onPress={() => { if (v === sel) return; buzz("tick"); setSel(v); place(v, true); later(() => onChange(v)); }} scale={0.95} accessibilityRole="radio" accessibilityLabel={l}
          onLayout={(e) => { lay[v] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (v === sel) { place(v, false); setReady(true); } }}
          style={{ flex: full ? 1 : undefined, minHeight: 32, paddingHorizontal: 12, borderRadius: 9, alignItems: "center", justifyContent: "center" }}>
          <T f={F.medium} s={13} lh={18} c={v === sel ? C.ink : C.ink2} lines={1}>{l}</T>
        </Press>
      ))}
    </View>
  );
}
/** .switch: the knob stretches while it travels. It flips the moment you tap (on the graphics thread); the setting
    behind it changes a frame later. */
export function Switch({ value, onChange, label }) {
  const C = useC();
  const [on, setOn] = useState(!!value);
  const v = useSharedValue(value ? 1 : 0), held = useSharedValue(0);
  useEffect(() => { if (!!value !== on) setOn(!!value); v.value = motionOn() ? withSpring(value ? 1 : 0, rs(S.small)) : value ? 1 : 0; }, [value]);
  const off = C.inset2, onC = C.accent;
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], [off, onC]) }));
  const knob = useAnimatedStyle(() => ({ width: 22 + 7 * held.value, left: 3 + v.value * (20 - 7 * held.value) }));
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}
      onPressIn={() => { held.value = withTiming(1, { duration: 90 }); }} onPressOut={() => { held.value = withSpring(0, rs(S.small)); }}
      onPress={() => { const next = !on; buzz("tick"); setOn(next); v.value = motionOn() ? withSpring(next ? 1 : 0, rs(S.small)) : next ? 1 : 0; later(() => onChange(next)); }}>
      <RAnimated.View style={[{ width: 48, height: 28, borderRadius: 14 }, track]}>
        <RAnimated.View style={[{ position: "absolute", top: 3, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }, knob]} />
      </RAnimated.View>
    </Pressable>
  );
}
/** details.more: a grey bar that unfolds what's below. */
export function More({ label, children }) {
  const C = useC();
  const tray = useTray() === "tray";
  const [open, setOpen] = useState(false);
  const v = useRef(new Animated.Value(0)).current;
  return (
    <View style={{ marginTop: 4 }}>
      <Press onPress={() => { setOpen(!open); v.setValue(0); springTo(v, 1, S.soft).start(); }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 6, borderRadius: 14, backgroundColor: tray ? mix(C.surface, 0.6, C.tray) : C.inset }}>
        <T f={F.medium} s={14} c={C.ink2}>{open ? "Show less" : label}</T>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}><Icon name="down" size={14} color={C.ink2} sw={2.4} /></View>
      </Press>
      {open ? <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>{children}</Animated.View> : null}
    </View>
  );
}
/** A wobble that dies away (wrong input). */
export function useShake() {
  const v = useRef(new Animated.Value(0)).current;
  const go = () => {
    buzz("error");
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 520, useNativeDriver: NATIVE }).start();
  };
  const style = { transform: [{ translateX: v.interpolate({ inputRange: [0, 0.12, 0.27, 0.42, 0.57, 0.72, 1], outputRange: [0, -9, 7, -4.5, 2.5, -1, 0] }) }] };
  return [style, go];
}

export const s = StyleSheet.create({ fill: { flex: 1 } });
