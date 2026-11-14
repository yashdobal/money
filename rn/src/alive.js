/* Money RN · alive (app.css "Alive"). With motion effects on, every card keeps moving a little, each on its own clock,
   so a screen never sits quite still:
     Sheen   a soft band of light crosses bars, tiles, card faces and charts
     Ping    a ring spreads from live dots: the status dot, "now" on the bank chart, the low point, today's date
     Bob     the icons at the start of the first rows of a tray rise and fall, one after another
     Breathe rings and the donut swell and settle
     Glow    warning and overdue badges brighten and dim
     tick    the digits of a big figure nudge in a wave (kit.js Odo)
   Every loop runs on the phone's graphics thread (the native driver), only on the screen you're looking at, and stops
   when the app is in the background, when "Motion effects" is off in Settings, or when the phone asks for reduced
   motion. Nothing here re-renders a screen: a loop starts and stops itself.
   As a website the same loops are CSS animations (the "…Css" versions below, same timings): the browser runs those on
   its own graphics thread too, so nothing here costs the page a frame. */
import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { pref, onChange } from "./store";
import { NATIVE } from "./motion";

const subs = new Set();
const st = { reduce: false, active: AppState.currentState !== "background", view: "today" };
const tell = () => subs.forEach((f) => f());
try {
  AccessibilityInfo.isReduceMotionEnabled().then((v) => { st.reduce = !!v; tell(); }).catch(() => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => { st.reduce = !!v; tell(); });
  AppState.addEventListener("change", (s) => { st.active = s === "active"; tell(); });
} catch (e) {}
onChange(tell);                                      // "Motion effects" switched in Settings
/** The screen on show (App.js): loops on the others rest. */
export function setAliveView(v) { if (st.view !== v) { st.view = v; tell(); } }
/** The screen a card belongs to; null for the app's own chrome and for sheets, which move whenever the app is open. */
export const PaneCtx = React.createContext(null);
const CSS = Platform.OS === "web";
export const aliveNow = (pane) => pref.get("fx", "1") !== "0" && !st.reduce && st.active && (pane === null || pane === undefined || pane === st.view);

/** Run a loop while this card should be moving. make(v) returns the Animated loop for the value v (0 at rest). */
export function useLoop(make, deps) {
  const pane = useContext(PaneCtx);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let anim = null;
    const sync = () => {
      const want = aliveNow(pane);
      if (want && !anim) { anim = make(v); anim.start(); }
      else if (!want && anim) { anim.stop(); anim = null; v.setValue(0); }
    };
    sync(); subs.add(sync);
    return () => { subs.delete(sync); if (anim) anim.stop(); };
  }, deps || []);
  return v;
}
const t = (v, to, ms, easing, delay) => Animated.timing(v, { toValue: to, duration: ms, easing: easing || Easing.inOut(Easing.sin), delay: delay || 0, useNativeDriver: NATIVE });
/** rest for `wait` ms, then 0 → 1 over `ms`, again and again (a sweep). */
const sweep = (v, ms, wait, easing, delay) => Animated.loop(Animated.sequence([Animated.delay(delay || 0), Animated.delay(wait), t(v, 1, ms, easing || Easing.bezier(0.4, 0, 0.2, 1)), Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: NATIVE })]));
/** 0 → 1 → 0, for ever (a breath). */
const breath = (v, ms, delay) => Animated.loop(Animated.sequence([Animated.delay(delay || 0), t(v, 1, ms / 2), t(v, 0, ms / 2)]));

let seq = 0;
/** A different phase for each thing that asks, so nothing moves in step. */
export const usePhase = (n = 6) => useRef(seq++ % n).current;

/** A band of light crossing whatever it sits in (the parent clips it: overflow hidden). w, h: the parent's size.
    tone: the light's colour; up: it climbs instead of crossing (the bars of a chart). */
function SheenNative({ w, h, tone = "#FFFFFF", strength = 0.55, every = 3800, delay = 0, up, id, band = 1 }) {
  const k = usePhase(5);
  const v = useLoop((x) => sweep(x, every * 0.42, every * 0.58, null, delay + k * 220), [w, h, every]);
  if (!w || !h) return null;
  const gid = "sh" + (id || "") + (up ? "u" : "");
  const full = w;                                    // band: the light's width as a share of the box (a chart wants a narrow one)
  if (!up) w = w * band;
  const move = up ? { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [h * 1.3, -h * 1.3] }) } : { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-w * 1.3, full + w * 0.3] }) };
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: [move] }}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1={up ? "1" : "0"} x2={up ? "0" : "1"} y2={up ? "0" : "0.25"}>
            <Stop offset="0.2" stopColor={tone} stopOpacity={0} /><Stop offset="0.5" stopColor={tone} stopOpacity={strength} /><Stop offset="0.8" stopColor={tone} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={"url(#" + gid + ")"} />
      </Svg>
    </Animated.View>
  );
}
/** Measures its own box and runs a Sheen over it: drop it in as the last child of anything with overflow hidden. */
function SheenFillNative(props) {
  const [box, setBox] = useState(null);
  return (
    <View pointerEvents="none" onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height }); }}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: props.radius || 0 }}>
      {box ? <SheenNative {...props} w={box.w} h={box.h} /> : null}
    </View>
  );
}

/** A ring spreading from a live dot. size: the dot's size; it grows to `grow` times that and fades. */
function PingNative({ size = 7, color, grow = 3.4, delay = 0, style, radius }) {
  const v = useLoop((x) => Animated.loop(Animated.sequence([Animated.delay(delay), t(x, 1, 1800, Easing.bezier(0.2, 0.6, 0.3, 1)), Animated.delay(800), Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: NATIVE })])), [delay]);
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", width: size, height: size, borderRadius: radius !== undefined ? radius : size / 2, backgroundColor: color,
    opacity: v.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, grow] }) }] }, style]} />;
}

/** Rises and falls a little, turning slightly (an icon). k: its place in the queue, so a column of them ripples. */
function BobNative({ k = 0, children, on = true }) {
  const v = useLoop((x) => (on ? breath(x, 3600, (k % 6) * 600) : Animated.delay(0)), [on, k]);
  if (!on) return children;
  return <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [1.2, -1.6] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "2deg"] }) }] }}>{children}</Animated.View>;
}
/** Which place in its tray a row has (kit.js Rows sets it); the first six rows' icons bob. -1: don't. */
export const BobCtx = React.createContext(-1);

/** Swells and settles (a ring, the donut). */
function BreatheNative({ children, by = 0.035, ms = 4200, style }) {
  const k = usePhase(3);
  const v = useLoop((x) => breath(x, ms, k * 1400), [ms]);
  return <Animated.View style={[style, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + by] }) }] }]}>{children}</Animated.View>;
}
/** Brightens and dims (a badge that wants attention). */
function GlowNative({ children, style }) {
  const v = useLoop((x) => breath(x, 2200), []);
  return <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) }]}>{children}</Animated.View>;
}
/** Turns a quarter, rests, turns again (the plus on the add button: it looks the same every quarter turn). */
function TurnNative({ children, every = 5200 }) {
  const v = useLoop((x) => sweep(x, every * 0.22, every * 0.78, Easing.bezier(0.5, 0, 0.2, 1.3), 1200), [every]);
  return <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>{children}</Animated.View>;
}
/** Flies off to the top right and comes back in from the bottom left (the plane on the airline you've picked).
    The parent clips it (overflow hidden). */
function FlyNative({ children, size = 38 }) {
  const v = useLoop((x) => Animated.loop(Animated.sequence([Animated.delay(2600), t(x, 1, 650, Easing.bezier(0.5, 0, 0.3, 1)), Animated.timing(x, { toValue: -1, duration: 0, useNativeDriver: NATIVE }), t(x, 0, 900, Easing.bezier(0.2, 0.8, 0.2, 1))])), [size]);
  const d = size * 0.9;
  return <Animated.View style={{ transform: [{ translateX: v.interpolate({ inputRange: [-1, 0, 1], outputRange: [-d, 0, d] }) }, { translateY: v.interpolate({ inputRange: [-1, 0, 1], outputRange: [d, 0, -d] }) }] }}>{children}</Animated.View>;
}
/** The nudge a digit of a big figure gets every few seconds, in a wave from the left. 0 at rest. */
function useTickNudge(k, lh) {
  const v = useLoop((x) => Animated.loop(Animated.sequence([Animated.delay(3000 + k * 80), t(x, 1, 180, Easing.bezier(0.3, 0, 0.3, 1)), t(x, 0, 260, Easing.bezier(0.3, 0, 0.3, 1)), Animated.delay(5560 - k * 80)])), [k]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [0, -0.13 * lh] });
}
function TickNative({ k, lh, children }) {
  const nudge = useTickNudge(k, lh);
  return <Animated.View style={{ transform: [{ translateY: nudge }] }}>{children}</Animated.View>;
}

/* ---------------- as a website: the same loops as CSS animations ---------------- */
/** Whether this card should be moving, re-drawing it when that changes. */
function useAliveNow() {
  const pane = useContext(PaneCtx);
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => aliveNow(pane), () => false);
}
/* react-native-web only writes @keyframes for styles made with StyleSheet.create (an inline style drops them), so each
   loop's style is made once and kept. */
const made = new Map();
const css = (frames, ms, o = {}) => {
  const style = { animationKeyframes: frames, animationDuration: ms + "ms", animationDelay: (o.delay || 0) + "ms", animationIterationCount: "infinite",
    animationTimingFunction: o.ease || "ease-in-out", animationFillMode: "backwards" };
  const key = JSON.stringify(style);
  if (!made.has(key)) made.set(key, StyleSheet.create({ s: style }).s);
  return made.get(key);
};
const tint = (tone, a) => (/^#[0-9a-f]{6}$/i.test(tone) ? "rgba(" + [1, 3, 5].map((i) => parseInt(tone.slice(i, i + 2), 16)).join(",") + "," + a + ")" : "color-mix(in srgb, " + tone + " " + Math.round(a * 100) + "%, transparent)");
function SheenCss({ tone = "#FFFFFF", strength = 0.55, every = 3800, delay = 0, up, band = 1 }) {
  const k = usePhase(5);
  if (!useAliveNow()) return null;
  const from = up ? "translateY(130%)" : "translateX(-130%)", to = up ? "translateY(-130%)" : "translateX(" + Math.round(100 / band + 30) + "%)";
  return <View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: up ? "100%" : band * 100 + "%", height: "100%",
    backgroundImage: "linear-gradient(" + (up ? "0deg" : "100deg") + ", transparent 20%, " + tint(tone, strength) + " 50%, transparent 80%)" },
    css({ "0%": { transform: from }, "58%": { transform: from }, "100%": { transform: to } }, every, { delay: delay + k * 220, ease: "cubic-bezier(0.4, 0, 0.2, 1)" })]} />;
}
function SheenFillCss(props) {
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: props.radius || 0 }}><SheenCss {...props} /></View>;
}
function PingCss({ size = 7, color, grow = 3.4, delay = 0, style, radius }) {
  if (!useAliveNow()) return null;
  return <View pointerEvents="none" style={[{ position: "absolute", width: size, height: size, borderRadius: radius !== undefined ? radius : size / 2, backgroundColor: color },
    css({ "0%": { opacity: 0.5, transform: "scale(1)" }, "69%": { opacity: 0, transform: "scale(" + grow + ")" }, "100%": { opacity: 0, transform: "scale(" + grow + ")" } }, 2600, { delay, ease: "cubic-bezier(0.2, 0.6, 0.3, 1)" }), style]} />;
}
function BobCss({ k = 0, children, on = true }) {
  const live = useAliveNow();
  if (!on || !live) return children;
  return <View style={css({ "0%": { transform: "translateY(1.2px) rotate(-2deg)" }, "50%": { transform: "translateY(-1.6px) rotate(2deg)" }, "100%": { transform: "translateY(1.2px) rotate(-2deg)" } }, 3600, { delay: -(k % 6) * 600 })}>{children}</View>;
}
function BreatheCss({ children, by = 0.035, ms = 4200, style }) {
  const k = usePhase(3);
  const live = useAliveNow();
  return <View style={[style, live && css({ "0%": { transform: "scale(1)" }, "50%": { transform: "scale(" + (1 + by) + ")" }, "100%": { transform: "scale(1)" } }, ms, { delay: -k * 1400 })]}>{children}</View>;
}
function GlowCss({ children, style }) {
  const live = useAliveNow();
  return <View style={[style, live && css({ "0%": { opacity: 1 }, "50%": { opacity: 0.72 }, "100%": { opacity: 1 } }, 2200)]}>{children}</View>;
}
function TurnCss({ children, every = 5200 }) {
  const live = useAliveNow();
  return <View style={live ? css({ "0%": { transform: "rotate(0deg)" }, "78%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(90deg)" } }, every, { delay: 1200, ease: "cubic-bezier(0.5, 0, 0.2, 1.3)" }) : null}>{children}</View>;
}
function FlyCss({ children, size = 38 }) {
  const live = useAliveNow(), d = Math.round(size * 0.9);
  return <View style={live ? css({ "0%": { transform: "translate(0px, 0px)" }, "62%": { transform: "translate(0px, 0px)" }, "78%": { transform: "translate(" + d + "px, " + -d + "px)" },
    "78.01%": { transform: "translate(" + -d + "px, " + d + "px)" }, "100%": { transform: "translate(0px, 0px)" } }, 4200, { ease: "cubic-bezier(0.5, 0, 0.3, 1)" }) : null}>{children}</View>;
}
function TickCss({ k, lh, children }) {
  const live = useAliveNow(), rest = { transform: "translateY(0px)" };
  return <View style={live ? css({ "0%": rest, "88%": rest, "94%": { transform: "translateY(" + (-0.13 * lh).toFixed(2) + "px)" }, "100%": rest }, 6000, { delay: 3000 + k * 80, ease: "cubic-bezier(0.3, 0, 0.3, 1)" }) : null}>{children}</View>;
}

/** A band of light crossing whatever it sits in (the parent clips it: overflow hidden). */
export const Sheen = CSS ? SheenCss : SheenNative;
/** Fills its parent and runs a Sheen over it: drop it in as the last child of anything. */
export const SheenFill = CSS ? SheenFillCss : SheenFillNative;
/** A ring spreading from a live dot. */
export const Ping = CSS ? PingCss : PingNative;
/** Rises and falls a little, turning slightly (an icon). */
export const Bob = CSS ? BobCss : BobNative;
/** Swells and settles (a ring, the donut). */
export const Breathe = CSS ? BreatheCss : BreatheNative;
/** Brightens and dims (a badge that wants attention). */
export const Glow = CSS ? GlowCss : GlowNative;
/** Turns a quarter, rests, turns again (the plus on the add button). */
export const Turn = CSS ? TurnCss : TurnNative;
/** Flies off to the top right and comes back in from the bottom left (the plane on the airline you've picked). */
export const Fly = CSS ? FlyCss : FlyNative;
/** A digit of a big figure: every few seconds the digits nudge in a wave (kit.js Odo wraps each digit's strip in it). */
export const Tick = CSS ? TickCss : TickNative;
