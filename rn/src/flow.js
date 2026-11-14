/* Money RN · "Where it goes" on Plan: the salary as one bar on the left, flowing out in ribbons to what it pays for
   (EMI, family, SIP, the emergency fund, card bills, what's yours to spend), each as wide as its share. The
   ribbons fade in one after another, and small dots keep flowing along them. Tap a stream to pick it out. */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Path, Rect, G } from "react-native-svg";
import RAnimated, { useSharedValue, useAnimatedProps, useAnimatedStyle, useFrameCallback, withDelay, withTiming, Easing } from "react-native-reanimated";
import { live } from "./live";
import { E } from "./store";
import { useC, F } from "./theme";
import { T, M, Panel, Press, buzz, settleAt } from "./kit";
import { S, rs, motionOn } from "./motion";

const AG = RAnimated.createAnimatedComponent(G), APath = RAnimated.createAnimatedComponent(Path), ARect = RAnimated.createAnimatedComponent(Rect);
const ROW = 40, BAR = 12;

export default function Flow({ first }) {
  const C = useC();
  const [w, setW] = useState(0);
  const [sel, setSel] = useState(-1);
  if (!E.settings.inc) return null;
  const mp = E.monthPlan(E.planCycleView()), A = mp.amt;
  const parts = [["EMI", mp.fixedTotal, C.nEmi], [E.familyTitle(), mp.family, C.nFamily], ["SIP", mp.sip, C.nSip], ["Emergency fund", mp.ef, C.nEf],
    ["Card bills", mp.cardsTotal, C.nCard], ["Yours to spend", Math.max(0, mp.spend), C.nYours]].filter((x) => x[1] >= 1);
  if (!parts.length || !(A > 0)) return null;
  const total = Math.max(A, parts.reduce((a, x) => a + x[1], 0));
  const n = parts.length, H = Math.max(200, n * (ROW + 6));
  return (
    <Panel title="Where it goes" kind="w" i={1} first={first}>
      <T s={14} lh={20} c={C.ink2} style={{ marginBottom: 12 }}>{"Your " + E.fmt(mp.cyc.p0) + " salary, stream by stream. Tap one to pick it out."}</T>
      <View style={{ height: H }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w ? <Streams parts={parts} total={total} w={w} H={H} sel={sel} setSel={setSel} first={first} /> : null}
      </View>
    </Panel>
  );
}

function Streams({ parts, total, w, H, sel, setSel, first }) {
  const C = useC();
  const n = parts.length, nx = Math.round(w * 0.46), mx = (BAR + nx) / 2;
  const geo = useMemo(() => {
    let s = 0;
    // the streams fan out: the targets take 60% of the height between them, the rest is space between
    const avail = H * (n > 1 ? 0.6 : 1), gap = n > 1 ? (H - avail) / (n - 1) : 0;
    const hn = parts.map((p) => Math.max(3, (p[1] / total) * avail)), scale = avail / hn.reduce((a, b) => a + b, 0);
    let y = 0;
    const out = parts.map((p, i) => {
      const h = (p[1] / total) * H, s0 = s, s1 = s + h; s = s1;
      const nh = hn[i] * scale, n0 = y, n1 = y + nh; y = n1 + gap;
      return { s0, s1, n0, n1, mid: (n0 + n1) / 2 };
    });
    // the labels: at their streams, but never closer than one row to each other
    const lab = out.map((g) => g.mid);
    for (let i = 1; i < n; i++) lab[i] = Math.max(lab[i], lab[i - 1] + ROW);
    if (lab[n - 1] > H - ROW / 2) { lab[n - 1] = H - ROW / 2; for (let i = n - 2; i >= 0; i--) lab[i] = Math.min(lab[i], lab[i + 1] - ROW); }
    out.forEach((g, i) => { g.lab = Math.max(ROW / 2, lab[i]); });
    return out;
  }, [w, H, total, parts.map((p) => p[1]).join()]);
  const on = motionOn() && first !== false;
  const grow = useSharedValue(on ? 0 : 1);
  const flowV = useSharedValue(0);
  useEffect(() => {
    const d = settleAt(1, first);
    if (on) grow.value = withDelay(d, withTiming(1, { duration: 900, easing: Easing.bezier(0.2, 0, 0, 1) }));

  }, []);
  // the dots flow only while Plan is the screen showing
  const flowOn = motionOn();
  useFrameCallback((f) => { "worklet"; if (flowOn && live.plan.value) flowV.value = (flowV.value - (Math.min(64, f.timeSincePreviousFrame || 16) * 30) / 1500) % 30; });
  const barP = useAnimatedProps(() => ({ height: H * Math.min(1, grow.value * 1.6) }));
  const pct = (v) => Math.round((v / total) * 100) + "%";
  return (
    <View style={{ flex: 1 }}>
      <Svg width={w} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        <Defs>
          {parts.map((p, i) => (
            <LinearGradient key={i} id={"fl" + i} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={C.ink} stopOpacity={0.1} /><Stop offset="1" stopColor={p[2]} stopOpacity={0.55} />
            </LinearGradient>
          ))}
        </Defs>
        <ARect x={0} y={0} width={BAR} rx={4} fill={C.ink} animatedProps={barP} />
        {parts.map((p, i) => <Stream key={i} i={i} g={geo[i]} p={p} nx={nx} mx={mx} grow={grow} flowV={flowV} dim={sel >= 0 && sel !== i} />)}
      </Svg>
      {parts.map((p, i) => (
        <Label key={i} i={i} name={p[0] + ", " + pct(p[1])} grow={grow} top={geo[i].lab - ROW / 2} left={nx + 18} dim={sel >= 0 && sel !== i}
          onPress={() => { buzz("tick"); setSel(sel === i ? -1 : i); }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T f={F.medium} s={14} lh={18} lines={1} style={{ flexShrink: 1 }}>{p[0]}</T>
            <T s={12.5} lh={16} c={C.ink3}>{pct(p[1])}</T>
          </View>
          <M v={p[1]} s={13.5} c={C.ink2} />
        </Label>
      ))}
    </View>
  );
}

function Stream({ i, g, p, nx, mx, grow, flowV, dim }) {
  const ribbon = "M" + BAR + " " + g.s0 + "C" + mx + " " + g.s0 + " " + mx + " " + g.n0 + " " + nx + " " + g.n0 + "L" + nx + " " + g.n1 + "C" + mx + " " + g.n1 + " " + mx + " " + g.s1 + " " + BAR + " " + g.s1 + "Z";
  const a = (g.s0 + g.s1) / 2, b = g.mid, line = "M" + BAR + " " + a + "C" + mx + " " + a + " " + mx + " " + b + " " + nx + " " + b;
  const k0 = 0.15 + i * 0.09;
  const gp = useAnimatedProps(() => ({ opacity: Math.max(0, Math.min(1, (grow.value - k0) / 0.35)) * (dim ? 0.25 : 1) }), [dim]);
  const fp = useAnimatedProps(() => ({ strokeDashoffset: flowV.value, opacity: grow.value >= 1 ? (dim ? 0.15 : 0.85) : 0 }), [dim]);
  const thick = Math.min(3, Math.max(1.6, (g.n1 - g.n0) * 0.35));
  return (
    <G>
      <AG animatedProps={gp}>
        <Path d={ribbon} fill={"url(#fl" + i + ")"} />
        <Rect x={nx} y={g.n0} width={10} height={Math.max(3, g.n1 - g.n0)} rx={3} fill={p[2]} />
      </AG>
      <APath d={line} fill="none" stroke="#FFFFFF" strokeWidth={thick} strokeLinecap="round" strokeDasharray={[0.5, 14.5]} animatedProps={fp} />
    </G>
  );
}

function Label({ i, name, grow, top, left, dim, onPress, children }) {
  const k0 = 0.2 + i * 0.09;
  const st = useAnimatedStyle(() => {
    const v = Math.max(0, Math.min(1, (grow.value - k0) / 0.35));
    return { opacity: v * (dim ? 0.4 : 1), transform: [{ translateX: (1 - v) * 10 }] };
  }, [dim]);
  return (
    <RAnimated.View style={[{ position: "absolute", top, left, right: 0, height: ROW, justifyContent: "center" }, st]}>
      <Press onPress={onPress} scale={0.98} accessibilityLabel={name}>{children}</Press>
    </RAnimated.View>
  );
}
