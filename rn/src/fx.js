/* Money RN · the effects on the Safe to spend card (choreo.js): a slow living light that drifts across it and follows
   your finger, and coins that drop in when a salary lands. "Motion effects" off in Settings turns them off. */
import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Animated, Easing, View, Text } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { useC, F } from "./theme";
import { motionOn, NATIVE } from "./motion";
import { E, storage } from "./store";
import { buzz } from "./kit";
import { GL, CoinRain, heroTouchGL, heroLeaveGL } from "./gl";

/** The card passes touches here (the light sits under the card's text, so it can't catch them itself). */
export const heroTouch = { follow: null, leave: null,
  on: (e) => { if (heroTouch.follow) heroTouch.follow(e); if (GL && motionOn()) heroTouchGL(e.x, e.y); },
  off: () => { if (heroTouch.leave) heroTouch.leave(); if (GL) heroLeaveGL(); } };
/** Two soft glows drifting slowly (14–19 s loops) over the card; a finger on the card draws the brighter one to it. */
export function HeroLight({ w, h }) {
  const C = useC();
  const on = motionOn();
  const a = useRef(new Animated.Value(0)).current, b = useRef(new Animated.Value(0)).current;
  const tx = useRef(new Animated.Value(w * 0.7)).current, ty = useRef(new Animated.Value(h * 0.25)).current, glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const loop = (v, ms) => Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE })]));
    const la = loop(a, 14000), lb = loop(b, 19000);
    la.start(); lb.start();
    return () => { la.stop(); lb.stop(); };
  }, [on]);
  if (!on) return null;
  const R = Math.max(w, h) * 0.9;
  const blob = (id, color, op) => (
    <Svg width={R * 2} height={R * 2}>
      <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={op} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
      <Circle cx={R} cy={R} r={R} fill={"url(#" + id + ")"} />
    </Svg>
  );
  const follow = ({ x, y }) => {
    Animated.parallel([Animated.spring(tx, { toValue: x, useNativeDriver: NATIVE, speed: 6, bounciness: 2 }), Animated.spring(ty, { toValue: y, useNativeDriver: NATIVE, speed: 6, bounciness: 2 }),
      Animated.timing(glow, { toValue: 1, duration: 200, useNativeDriver: NATIVE })]).start();
  };
  const leave = () => Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: NATIVE }).start();
  heroTouch.follow = follow; heroTouch.leave = leave;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden" }}>
        <Animated.View style={{ position: "absolute", left: -R, top: -R, transform: [
          { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [w * 0.95, w * 0.45] }) }, { translateY: b.interpolate({ inputRange: [0, 1], outputRange: [h * 0.05, h * 0.4] }) }] }}>
          {blob("lgA", C.heroGlow, 0.13)}
        </Animated.View>
        <Animated.View style={{ position: "absolute", left: -R * 0.7, top: -R * 0.7, transform: [
          { translateX: b.interpolate({ inputRange: [0, 1], outputRange: [w * 0.1, w * 0.55] }) }, { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [h * 0.95, h * 0.6] }) }, { scale: 0.7 }] }}>
          {blob("lgB", C.heroGlow, 0.07)}
        </Animated.View>
        <Animated.View style={{ position: "absolute", left: -R * 0.45, top: -R * 0.45, opacity: glow, transform: [{ translateX: tx }, { translateY: ty }, { scale: 0.45 }] }}>
          {blob("lgT", C.heroGlow, 0.22)}
        </Animated.View>
      </View>
    </View>
  );
}

/* ---------------- coins when a salary lands ---------------- */
let dropNext = null;
/** Ask for coins the next time Today shows (after you add money in). */
export function coinsNext() { storage.setItem("money-coins-next", "1"); if (dropNext) dropNext(7); }

/** A handful of coins fall into the card, bounce, settle and fade (once per salary, within 4 days of it). */
export function Coins() {
  const C = useC();
  const [drop, setDrop] = useState(null);
  const [box, setBox] = useState(null);
  useEffect(() => {
    if (!motionOn()) return;
    let n = 0;
    try {
      const cyc = E.payCycle(), sal = E.salaryFor(cyc), key = "money-coins-" + E.iso(cyc.p0);
      if (sal.credited && Date.now() - sal.credited.getTime() < 4 * 86400000 && !storage.getItem(key)) { storage.setItem(key, "1"); n = 14; }
      if (storage.getItem("money-coins-next")) { storage.removeItem("money-coins-next"); n = n || 7; }
    } catch (e) {}
    dropNext = (k) => setDrop({ n: k, at: Date.now() });
    const tm = n ? setTimeout(() => setDrop({ n, at: Date.now() }), 1000) : null;
    return () => { clearTimeout(tm); dropNext = null; };
  }, []);
  const tone = C.palette === "minimal" || C.palette === "signal" ? "#D9D4C7" : C.accent;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {drop && box ? (GL
        ? <CoinRain key={drop.at} n={drop.n + 4} w={box.width} h={box.height} tone={tone} onDone={() => setDrop(null)} />
        : Array.from({ length: drop.n }, (_, i) => <Coin key={drop.at + "-" + i} i={i} n={drop.n} w={box.width} h={box.height} tone={tone} />)) : null}
    </View>
  );
}
function Coin({ i, n, w, h, tone }) {
  const R = 13;
  const fall = useRef(new Animated.Value(0)).current, fade = useRef(new Animated.Value(1)).current, spin = useRef(new Animated.Value(0)).current;
  const x = useRef(R + Math.random() * (w - 2 * R)).current, rot = useRef((Math.random() - 0.5) * 540).current;
  const floor = h - R - 4 - (i % 3) * 9;
  useEffect(() => {
    const d = i * 70;
    Animated.sequence([
      Animated.delay(d),
      Animated.parallel([
        Animated.timing(fall, { toValue: 1, duration: 1100 + Math.random() * 300, easing: Easing.bounce, useNativeDriver: NATIVE }),
        Animated.timing(spin, { toValue: 1, duration: 1300, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
      ]),
      Animated.delay(900 + (n - i) * 40),
      Animated.timing(fade, { toValue: 0, duration: 600, useNativeDriver: NATIVE }),
    ]).start();
    if (i === 0) setTimeout(() => buzz("heavy"), d + 500);
  }, []);
  return (
    <Animated.View style={{ position: "absolute", left: x - R, top: 0, width: R * 2, height: R * 2, borderRadius: R, opacity: fade,
      transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-R * 3, floor - R] }) }, { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", rot + "deg"] }) }] }}>
      <Svg width={R * 2} height={R * 2}>
        <Defs><RadialGradient id={"cg" + i} cx="35%" cy="30%" r="75%"><Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.85} /><Stop offset="0.35" stopColor={tone} /><Stop offset="1" stopColor="#000000" stopOpacity={0.35} /></RadialGradient></Defs>
        <Circle cx={R} cy={R} r={R} fill={tone} />
        <Circle cx={R} cy={R} r={R} fill={"url(#cg" + i + ")"} opacity={0.55} />
        <Circle cx={R} cy={R} r={R - 3} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      </Svg>
      <Text style={{ position: "absolute", left: 0, right: 0, top: 4, textAlign: "center", fontFamily: F.semi, fontSize: 13, color: "rgba(20,20,20,0.62)" }}>₹</Text>
    </Animated.View>
  );
}
