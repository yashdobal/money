/* Money RN · motion: the Money app's own springs (app/motion.js and app/choreo.js), so everything moves the same way.
   A spring is a stiffness and a damping ratio (Material 3 physics); here it becomes an easing curve plus how long it
   takes to settle, exactly as the web app turns it into CSS linear(). */
import { Animated, Easing, Platform } from "react-native";
import { pref } from "./store";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A damped spring (mass 1): {ease(t 0..1) → 0..~1, duration ms}. */
export function spring(stiffness, damping) {
  const w0 = Math.sqrt(stiffness), z = damping;
  const wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const x = z < 1
    ? (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
    : (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const T = clamp(z < 1 ? Math.log(1000) / (z * w0) : 9.2 / w0, 0.12, 1.6);
  return { ease: (k) => (k >= 1 ? 1 : x(T * k)), duration: Math.round(T * 1000), k: stiffness, z: damping };
}
/* app/motion.js */
export const S = {
  press: spring(1400, 0.6), small: spring(1000, 0.72), liquid: spring(520, 0.62), liquidLag: spring(300, 0.74),
  sheet: spring(560, 0.86), page: spring(320, 0.9), icon: spring(700, 0.42), fx: spring(1600, 1),
  /* app/choreo.js (anime.js springs: bounce, duration) */
  block: spring(150, 0.78), soft: spring(190, 0.9), pop: spring(420, 0.45), grow: spring(110, 0.74),
};
/* app.css curves */
export const OUT = Easing.bezier(0.3, 0, 0.8, 0.15);          // leaving: accelerate away
export const EASE_OUT = Easing.bezier(0.2, 0, 0, 1);
export const SOFT = Easing.bezier(0.25, 1, 0.5, 1);
export const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const NATIVE = Platform.OS !== "web";

export const motionOn = () => pref.get("fx", "1") !== "0";
/** Animate an Animated.Value along a spring. */
export function springTo(v, to, s, o) {
  o = o || {};
  return Animated.timing(v, { toValue: to, duration: s.duration, easing: s.ease, delay: o.delay || 0, useNativeDriver: o.native !== undefined ? o.native : NATIVE });
}
/** An entrance: v goes to 1 along a spring. If something cuts it short (its screen is put away mid-way), it lands on
    1 anyway, so a bar or a chart is never left half-grown. */
export function enter(v, s, o) { entrance(v, (d) => springTo(v, 1, s, Object.assign({}, o, { delay: d })), (o && o.delay) || 0); }

/* In the browser (the website and the Android app's page), a screen you leave is frozen: React takes its animated
   views off the values that drive them, which stops whatever was running, and puts them back when you return. A
   value that was half-way through its entrance would stay there (a card left faded out). So an entrance that is cut
   short waits until its views are back and carries on from where it stopped. */
const WEB = Platform.OS === "web";
const waiting = new Set();
const attached = (v) => { try { return v.__getChildren().length > 0; } catch (e) { return true; } };
function resumeWaiting() {
  waiting.forEach((w) => { if (attached(w.v)) { waiting.delete(w); w.go(); } else if (Date.now() - w.at > 600000) waiting.delete(w); });
}
let polling = 0;
function poll() {
  if (polling) return;
  const t0 = Date.now();
  const step = () => { resumeWaiting(); if (waiting.size && Date.now() - t0 < 3000) polling = requestAnimationFrame(step); else polling = 0; };
  polling = requestAnimationFrame(step);
}
/** A screen was shown again: carry on the entrances it had cut short. */
export function screenShown() { if (WEB && waiting.size) { resumeWaiting(); poll(); } }
/** Run an entrance (make(delay) gives the animation to 1) so that, if it's cut short, it isn't left half-way. */
export function entrance(v, make, delay) {
  make(delay || 0).start((r) => {
    if (!r || r.finished) return;
    if (!WEB) { v.setValue(1); return; }
    waiting.add({ v, at: Date.now(), go: () => entrance(v, make, 0) });
    poll();
  });
}
export function timeTo(v, to, duration, easing, o) {
  o = o || {};
  return Animated.timing(v, { toValue: to, duration, easing: easing || EASE_OUT, delay: o.delay || 0, useNativeDriver: o.native !== undefined ? o.native : NATIVE });
}
/** Run fn(progress 0..1) each frame along a spring (for things Animated can't drive, like SVG geometry). */
export function frames(s, fn, delay) {
  let raf = 0, t0 = 0, stop = false;
  const go = () => {
    t0 = Date.now();
    const step = () => {
      if (stop) return;
      const k = Math.min(1, (Date.now() - t0) / s.duration);
      fn(s.ease(k), k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const tm = setTimeout(go, delay || 0);
  return () => { stop = true; clearTimeout(tm); cancelAnimationFrame(raf); };
}

/** The same spring for Reanimated (withSpring), which runs on the phone's graphics thread. */
export const rs = (s) => ({ stiffness: s.k, damping: 2 * s.z * Math.sqrt(s.k), mass: 1, overshootClamping: false });
