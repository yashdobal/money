/* input.range (app.css): an 8 px track filled in the part's colour, a 28 px white knob ringed in it that grows and
   glows while you hold it. onChange while dragging, onDone when you let go. */
import React, { useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";
import { useC, rgba } from "./theme";
import { buzz } from "./kit";
import { S, springTo, timeTo } from "./motion";

export default function Slider({ value, max, step = 100, color, onChange, onDone, label }) {
  const C = useC();
  const [w, setW] = useState(1);
  const held = useRef(new Animated.Value(0)).current;
  const live = useRef({ w: 1, max, step, onChange, onDone, last: value, x0: 0, tick: 0 });
  Object.assign(live.current, { w, max, step, onChange, onDone });
  const valAt = (x) => { const L = live.current, k = Math.max(0, Math.min(1, (x - 14) / Math.max(1, L.w - 28))); return Math.round((k * L.max) / L.step) * L.step; };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { const L = live.current; L.x0 = e.nativeEvent.locationX; const v = valAt(L.x0); L.last = v; springTo(held, 1, S.press, { native: false }).start(); L.onChange && L.onChange(v); },
    onPanResponderMove: (e, g) => {
      const L = live.current, v = valAt(L.x0 + g.dx);
      if (v !== L.last) { L.last = v; L.onChange && L.onChange(v); const t = Math.floor(v / (L.max / 20 || 1)); if (t !== L.tick) { L.tick = t; buzz("tick"); } }
    },
    onPanResponderRelease: () => { const L = live.current; springTo(held, 0, S.press, { native: false }).start(); buzz("tick"); L.onDone && L.onDone(L.last); },
    onPanResponderTerminate: () => { const L = live.current; springTo(held, 0, S.press, { native: false }).start(); L.onDone && L.onDone(L.last); },
  })).current;
  const c = color || C.accent;
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const kx = 14 + p * Math.max(0, w - 28);
  return (
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: Math.round(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => { const v = Math.max(0, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? 1 : -1) * step * 10)); onChange && onChange(v); onDone && onDone(v); }}
      style={{ height: 36, marginTop: 4, justifyContent: "center" }} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      <View pointerEvents="none" style={{ height: 8, borderRadius: 4, backgroundColor: C.inset2, overflow: "hidden" }}>
        <View style={{ width: kx, height: 8, backgroundColor: c }} />
      </View>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: kx - 14, top: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: C.surface, borderWidth: 2.5, borderColor: c,
        shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
        transform: [{ scale: held.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }] }}>
        <Animated.View style={{ position: "absolute", left: -10.5, top: -10.5, right: -10.5, bottom: -10.5, borderRadius: 30, backgroundColor: rgba(c.length === 7 ? c : "#888888", 0.18), opacity: held }} />
      </Animated.View>
    </View>
  );
}
