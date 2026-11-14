/* Toasts (app.css .toast): one line in ink on a 16 px pill, just above the dock. It drips out of the dock (grows from a
   squashed drop on the liquid spring) and leaves quickly, shrinking a little. Over a sheet it sits at the bottom of the
   sheet instead. An action (like Undo) is underlined. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ui, useTick } from "./store";
import { nav } from "./nav";
import { useC, F } from "./theme";
import { T, buzz } from "./kit";
import { S, OUT, springTo, timeTo, motionOn } from "./motion";

let cur = null;
const subs = new Set();
const set = (t) => { cur = t; subs.forEach((f) => f(t)); };
let timer = null;
ui.toastFn = (msg, o) => {
  o = o || {};
  if (o.tone === "alert") buzz("error"); else if (o.tone === "warn") buzz("tick");
  clearTimeout(timer);
  set({ msg, o, k: Date.now() + Math.random() });
  timer = setTimeout(() => set(cur ? { ...cur, out: true } : null), o.ms || 3200);
};

/** inSheet: the copy inside a sheet's window (sheets are their own window on Android, above everything else). */
export default function ToastHost({ inSheet, wide }) {
  useTick();
  const [t, setT] = useState(cur);
  useEffect(() => { subs.add(setT); return () => subs.delete(setT); }, []);
  const insets = useSafeAreaInsets();
  if (!t || !!nav.sheet !== !!inSheet) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", zIndex: 70, left: 0, right: 0, bottom: (inSheet || wide ? 24 : 86) + insets.bottom, alignItems: "center", paddingHorizontal: 16 }}>
      <Toast key={t.k} t={t} />
    </View>
  );
}

function Toast({ t }) {
  const C = useC();
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current, op = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  const out = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (motionOn()) { springTo(v, 1, S.liquid).start(); timeTo(op, 1, 140).start(); } }, []);
  useEffect(() => {
    if (!t.out) return;
    Animated.parallel([timeTo(out, 1, 200, OUT), timeTo(op, 0, 180, OUT)]).start(() => { if (cur && cur.k === t.k) set(null); });
  }, [t.out]);
  const tone = t.o.tone, bg = tone === "alert" ? C.alert : tone === "warn" ? C.warn : C.ink, fg = tone === "alert" || tone === "warn" ? "#FFFFFF" : C.surface;
  return (
    <Animated.View accessibilityLiveRegion="polite" style={{ maxWidth: 440, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: bg,
      shadowColor: "#16182E", shadowOpacity: C.dark ? 0.7 : 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 10, opacity: op, transformOrigin: "50% 100%",
      transform: [
        { translateY: Animated.add(v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }), out.interpolate({ inputRange: [0, 1], outputRange: [0, 10] })) },
        { scaleX: Animated.multiply(v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), out.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] })) },
        { scaleY: Animated.multiply(v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), out.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] })) },
      ] }}>
      <T s={14.5} lh={19} c={fg} style={{ flexShrink: 1 }}>{t.msg}</T>
      {t.o.action ? (
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { buzz("tick"); set({ ...t, out: true }); t.o.action.fn(); }}>
          <T f={F.bold} s={14.5} lh={19} c={fg} style={{ textDecorationLine: "underline" }}>{t.o.action.label}</T>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
