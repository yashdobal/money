/* Money RN · charts, with the Money app's geometry and colours, and its entrances (choreo.js): lines draw themselves,
   the area under them fades up, marker dots pop at the end, a donut sweeps round slice after slice, bars grow. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";
import Svg, { Path, Line, Circle, Defs, LinearGradient, RadialGradient, Stop } from "react-native-svg";
import { E } from "./store";
import { useC, F, rgba } from "./theme";
import { T, M, amt, compact, catHue, buzz, hidden, Press } from "./kit";
import { S, springTo, enter, entrance, motionOn, frames } from "./motion";
import { Sheen, Ping, Breathe } from "./alive";
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, runOnJS, Easing as REasing } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);

/** Length of a path made of M/L/H/V commands (enough for our lines). */
function pathLength(d) {
  let x = 0, y = 0, L = 0;
  const re = /([MLHV])\s*([-\d.]+)(?:\s+([-\d.]+))?/g;
  let m;
  while ((m = re.exec(d))) {
    const a = parseFloat(m[2]), b = m[3] !== undefined ? parseFloat(m[3]) : null;
    if (m[1] === "M") { x = a; y = b; }
    else if (m[1] === "L") { L += Math.hypot(a - x, b - y); x = a; y = b; }
    else if (m[1] === "H") { L += Math.abs(a - x); x = a; }
    else if (m[1] === "V") { L += Math.abs(a - y); y = a; }
  }
  return L || 1;
}
/** A line that draws itself (1.25 s, inOutQuart), then its dots pop. */
function useDraw(delay, run) {
  const on = run !== false && motionOn();
  const k = useRef(new Animated.Value(on ? 0 : 1)).current;
  const fade = useRef(new Animated.Value(on ? 0 : 1)).current;
  const dot = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    const inOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
    entrance(k, (d) => Animated.timing(k, { toValue: 1, duration: 1250, delay: d, easing: inOutQuart, useNativeDriver: false }), delay + 60);
    entrance(fade, (d) => Animated.timing(fade, { toValue: 1, duration: 900, delay: d, useNativeDriver: false }), delay + 420);
    enter(dot, S.pop, { delay: delay + 1150, native: false });
  }, []);
  return { k, fade, dot };
}

/** The bank balance as steps, from today to the day before the salary after next (inside the Safe to spend card). */
export function HeroChart({ c, delay = 0, run }) {
  const C = useC();
  const [w, setW] = useState(320);
  const an = useDraw(delay, run);
  if (!c || !c.pts.length) return null;
  const W = 320, H = 96, T0 = +c.from, T1 = +c.to, span = Math.max(1, T1 - T0);
  const bb = E.bankBalance(), startBal = bb ? bb.bal : c.pts[0].bal;
  const pts = [{ d: c.from, bal: startBal }].concat(c.pts);
  const vals = pts.map((p) => p.bal).concat([0, c.buffer]);
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const pad = (hi - lo) * 0.12 || 1000; lo -= pad; hi += pad;
  const X = (d) => ((+d - T0) / span) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
  let d = "M0 " + Y(pts[0].bal).toFixed(1);
  pts.forEach((p, i) => { if (i) d += "H" + X(p.d).toFixed(1); d += "V" + Y(p.bal).toFixed(1); });
  d += "H" + W;
  const L = pathLength(d);
  /* the glowing dot that rides the tip of the line as it draws: the same corners, by distance along the line */
  const vx = [[0, Y(pts[0].bal)]];
  pts.forEach((p, i) => { if (i) vx.push([X(p.d), vx[vx.length - 1][1]]); vx.push([X(p.d), Y(p.bal)]); });
  vx.push([W, vx[vx.length - 1][1]]);
  const tip = { at: [0], x: [vx[0][0]], y: [vx[0][1]] };
  let run_ = 0;
  for (let i = 1; i < vx.length; i++) {
    const seg = Math.abs(vx[i][0] - vx[i - 1][0]) + Math.abs(vx[i][1] - vx[i - 1][1]);
    if (seg < 0.01) continue;
    run_ += seg; tip.at.push(run_); tip.x.push(vx[i][0]); tip.y.push(vx[i][1]);
  }
  const tot = Math.max(1e-6, run_), tipIn = tip.at.map((a) => a / tot);
  const area = d + "V" + H + "H0Z";
  const zeroY = Y(c.buffer || 0), lowX = X(c.low.d), lowY = Y(c.low.bal), short = c.low.bal < (c.buffer || 0);
  const lbl = (x, text, align) => <T key={text} s={11.5} lh={15} c={C.heroInk2} style={{ position: "absolute", top: 0, left: align === "start" ? 0 : undefined, right: align === "end" ? 0 : undefined,
    ...(align ? {} : { left: (x / W) * w - 60, width: 120, textAlign: "center" }) }} lines={1}>{text}</T>;
  return (
    <View style={{ marginTop: 16 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <Defs><LinearGradient id="hcFill" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} /><Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} /></LinearGradient></Defs>
        <APath d={area} fill="url(#hcFill)" opacity={an.fade} />
        <Line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        {c.paydays.filter((p) => X(p) < W - 1).map((p, i) => <Line key={i} x1={X(p)} x2={X(p)} y1={0} y2={H} stroke={C.heroLine} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <APath d={d} fill="none" stroke={C.heroChart} strokeWidth={2} strokeLinejoin="round" strokeDasharray={[L, L]} strokeDashoffset={an.k.interpolate({ inputRange: [0, 1], outputRange: [L, 0] })} />
        <ACircle cx={lowX} cy={lowY} r={an.dot.interpolate({ inputRange: [0, 1], outputRange: [0, 3.2] })} fill={short ? "#FF8F80" : C.heroChart} stroke={C.heroA} strokeWidth={2} />
      </Svg>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, height: H, overflow: "hidden" }}><Sheen w={w} h={H} band={0.22} strength={0.16} every={6800} id="hc" /></View>
      <Ping size={6.4} color={short ? "#FF8F80" : C.heroChart} delay={800} style={{ left: (lowX / W) * w - 3.2, top: lowY - 3.2 }} />
      {tipIn.length > 1 && motionOn() && run !== false ? (
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: -11, top: -11, width: 22, height: 22, alignItems: "center", justifyContent: "center",
          opacity: an.k.interpolate({ inputRange: [0, 0.02, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateX: an.k.interpolate({ inputRange: tipIn, outputRange: tip.x.map((x) => (x / W) * w) }) }, { translateY: an.k.interpolate({ inputRange: tipIn, outputRange: tip.y }) }] }}>
          <Svg width={22} height={22}>
            <Defs><RadialGradient id="tipGlow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={C.heroGlow} stopOpacity={0.75} /><Stop offset="1" stopColor={C.heroGlow} stopOpacity={0} /></RadialGradient></Defs>
            <Circle cx={11} cy={11} r={11} fill="url(#tipGlow)" />
            <Circle cx={11} cy={11} r={3} fill="#FFFFFF" />
          </Svg>
        </Animated.View>
      ) : null}
      <View style={{ height: 18, marginTop: 6 }}>
        {lbl(0, "Today", "start")}
        {c.paydays.filter((p) => X(p) > W * 0.3 && X(p) < W * 0.7).map((p) => lbl(X(p), "Payday " + E.fmt(p)))}
        {lbl(W, E.fmt(E.addDays(c.to, -1)), "end")}
      </View>
    </View>
  );
}

/** The forecast from today to the next payday (the hero's steps), as points. */
export function bankAhead(hero) {
  if (!hero || hero.state !== "ok" || !hero.chart) return [];
  const end = hero.f.P1, out = [];
  hero.chart.pts.forEach((p) => { if (p.d < end) out.push({ d: p.d, bal: p.bal }); });
  const bb = E.bankBalance(), last = out.length ? out[out.length - 1].bal : bb ? bb.bal : 0;
  return out.concat([{ d: end, bal: last }]);
}

/* ---------------- the bank balance ---------------- */
/** A smooth line through the days (monotone cubic: it never overshoots a day's value, so no fake dips or peaks). */
function smooth(xs, ys) {
  const n = xs.length;
  if (n < 2) return n ? "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1) : "";
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1e-6); m.push((ys[i + 1] - ys[i]) / (dx[i])); }
  t.push(m[0]);
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  let d = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += "C" + (xs[i] + h).toFixed(1) + " " + (ys[i] + t[i] * h).toFixed(1) + " " + (xs[i + 1] - h).toFixed(1) + " " + (ys[i + 1] - t[i + 1] * h).toFixed(1) + " " + xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
  }
  return d;
}

/** The bank balance: the past as a smooth line over a soft fill, the days ahead as a dashed step line to payday,
    salaries and card bills as dots, and today. It's drawn at its real width (no stretching) and reveals once, left to
    right. With head (the History sheet), touch and drag across it: a line and a dot follow your finger on the graphics
    thread, and the figure above reads the balance on that day. Only that figure redraws, and only when the day
    under your finger changes. */
export function BankChart({ pts, ahead, marks, h, big, head, delay = 0, run }) {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (Math.abs(w - width) > 1) setWidth(w); }} style={{ marginTop: big ? 6 : 12 }}>
      {head ? <BankRead head={head} /> : null}
      {width ? <BankPlot pts={pts} ahead={ahead} marks={marks} H={h} big={big} W={width} scrub={!!head} head={head} delay={delay} run={run} /> : <View style={{ height: h }} />}
      <BankAxis pts={pts} ahead={ahead} w={width} />
    </View>
  );
}

/* the figure above the big chart: today's balance, or the day under your finger */
const scrubBus = { fn: null };
function BankRead({ head }) {
  const C = useC();
  const [p, setP] = useState(null);
  useEffect(() => { scrubBus.fn = setP; return () => { if (scrubBus.fn === setP) scrubBus.fn = null; }; }, []);
  const v = p ? p.bal : head.now;
  return (
    <View style={{ marginBottom: 6 }}>
      <T f={F.medium} s={13.5} c={C.ink2}>{p ? (p.today ? "Today" : E.fmtD(p.d)) + (p.ahead ? " · expected" : "") : "Today"}</T>
      <M v={v} f={F.fig} s={30} tone={v < 0 ? "alert" : ""} style={{ lineHeight: 36 }} />
    </View>
  );
}

const BankPlot = React.memo(function BankPlot({ pts, ahead, marks, H, big, W, scrub, delay, run }) {
  const C = useC();
  const g = useMemo(() => {
    const all = pts.concat(ahead);
    const T0 = +pts[0].d, T1 = Math.max(+all[all.length - 1].d, T0 + 864e5), span = T1 - T0;
    const vals = all.map((p) => p.bal);
    let lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals);
    if (lo === hi) hi = lo + 1000;
    const pad = (hi - lo) * 0.12; lo -= lo < 0 ? pad : 0; hi += pad;
    const top = 8, bot = 6, X = (d) => ((+d - T0) / span) * (W - 8) + 4, Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bot);
    const xs = pts.map((p) => X(p.d)), ys = pts.map((p) => Y(p.bal));
    const line = smooth(xs, ys);
    const area = line + "L" + xs[xs.length - 1].toFixed(1) + " " + H + "L" + xs[0].toFixed(1) + " " + H + "Z";
    const now = pts[pts.length - 1];
    let fut = "";
    if (ahead.length) { fut = "M" + X(now.d).toFixed(1) + " " + Y(now.bal).toFixed(1); ahead.forEach((p) => { fut += "H" + X(p.d).toFixed(1) + "V" + Y(p.bal).toFixed(1); }); }
    const byDay = {}; pts.forEach((p) => { byDay[+p.d] = p; });
    const dots = marks.filter((m) => +m.d >= T0 && byDay[+m.d] && m.kind !== "set").map((m) => ({ x: X(m.d), y: Y(byDay[+m.d].bal), kind: m.kind }));
    // the points a finger can land on: every day so far, then each step ahead
    const sx = all.map((p) => X(p.d)), sy = all.map((p) => Y(p.bal));
    return { line, area, fut, dots, nx: X(now.d), ny: Y(now.bal), zeroY: lo < 0 ? Y(0) : null, sx, sy, all, nowT: +now.d };
  }, [pts, ahead, marks, H, W]);

  /* the entrance: a clip opening left to right (one width, on the graphics thread) */
  const on = run !== false && motionOn();
  const rev = useSharedValue(on ? 0 : 1);
  useEffect(() => { if (on) rev.value = withDelay(delay + 80, withTiming(1, { duration: 900, easing: REasing.bezier(0.25, 0.8, 0.25, 1) })); }, []);
  const clip = useAnimatedStyle(() => ({ width: Math.max(1, rev.value * W) }));
  const nowDot = useAnimatedStyle(() => ({ opacity: rev.value > 0.97 ? 1 : 0, transform: [{ scale: rev.value > 0.97 ? 1 : 0.4 }] }));

  /* scrubbing */
  const sxV = useSharedValue(g.sx), syV = useSharedValue(g.sy), hot = useSharedValue(0), ix = useSharedValue(-1);
  useEffect(() => { sxV.value = g.sx; syV.value = g.sy; }, [g]);
  const tell = (i) => {
    buzz("tick");
    const f = scrubBus.fn; if (!f) return;
    if (i < 0) return f(null);
    const p = g.all[i];
    f({ d: p.d, bal: p.bal, ahead: +p.d > g.nowT, today: +p.d === g.nowT });
  };
  const near = (x) => {
    "worklet";
    const a = sxV.value; let k = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - x) < Math.abs(a[k] - x)) k = i;
    return k;
  };
  const move = (x) => {
    "worklet";
    const k = near(x);
    if (k !== ix.value) { ix.value = k; runOnJS(tell)(k); }
  };
  const pan = Gesture.Pan().enabled(scrub).activeOffsetX([-3, 3]).failOffsetY([-14, 14])
    .onBegin((e) => { "worklet"; hot.value = withTiming(1, { duration: 120 }); move(e.x); })
    .onUpdate((e) => { "worklet"; move(e.x); })
    .onFinalize(() => { "worklet"; hot.value = withDelay(900, withTiming(0, { duration: 220 })); ix.value = -1; runOnJS(tell)(-1); });
  const cur = useAnimatedStyle(() => {
    const k = ix.value < 0 ? sxV.value.length - 1 : ix.value;
    return { opacity: hot.value, transform: [{ translateX: withTiming(sxV.value[k], { duration: 70 }) }] };
  });
  const curDot = useAnimatedStyle(() => {
    const k = ix.value < 0 ? sxV.value.length - 1 : ix.value;
    return { opacity: hot.value, transform: [{ translateX: withTiming(sxV.value[k] - 6, { duration: 70 }) }, { translateY: withTiming(syV.value[k] - 6, { duration: 70 }) }] };
  });

  const id = "bk" + (big ? "B" : "");
  const r = big ? 4 : 3.4;
  return (
    // pan-y: an up-or-down swipe that starts on the chart still scrolls the page; only a sideways drag reads the days
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={{ height: H, width: W }}>
        {g.zeroY !== null ? <Svg width={W} height={H} style={{ position: "absolute" }}><Line x1={0} x2={W} y1={g.zeroY} y2={g.zeroY} stroke={C.alert} strokeOpacity={0.6} strokeDasharray="2 4" /></Svg> : null}
        <RAnimated.View style={[{ position: "absolute", left: 0, top: 0, height: H, overflow: "hidden" }, clip]}>
          <Svg width={W} height={H}>
            <Defs><LinearGradient id={id} x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={C.accent} stopOpacity={0.24} /><Stop offset="0.7" stopColor={C.accent} stopOpacity={0.05} /><Stop offset="1" stopColor={C.accent} stopOpacity={0} /></LinearGradient></Defs>
            <Path d={g.area} fill={"url(#" + id + ")"} />
            {g.fut ? <Path d={g.fut} fill="none" stroke={C.ink3} strokeWidth={1.6} strokeDasharray="4 4" strokeLinejoin="round" /> : null}
            <Path d={g.line} fill="none" stroke={C.accent} strokeWidth={big ? 2.6 : 2.3} strokeLinejoin="round" strokeLinecap="round" />
            {g.dots.map((d, i) => <Circle key={i} cx={d.x} cy={d.y} r={big ? 3.4 : 2.8} fill={d.kind === "salary" ? C.pos : C.alert} stroke={C.surface} strokeWidth={1.5} />)}
          </Svg>
        </RAnimated.View>
        <RAnimated.View pointerEvents="none" style={[{ position: "absolute", left: g.nx - r - 4, top: g.ny - r - 4, width: 2 * r + 8, height: 2 * r + 8, borderRadius: r + 4, backgroundColor: rgba(C.accent, 0.18), alignItems: "center", justifyContent: "center" }, nowDot]}>
          <View style={{ width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: C.accent, borderWidth: 2, borderColor: C.surface }} />
        </RAnimated.View>
        {scrub ? <>
          <RAnimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 1.5, height: H, backgroundColor: C.ink3 }, cur]} />
          <RAnimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: C.surface, borderWidth: 3, borderColor: C.accent, boxShadow: "0px 2px 6px rgba(0,0,0,0.25)" }, curDot]} />
        </> : null}
      </View>
    </GestureDetector>
  );
});
function BankAxis({ pts, ahead, w }) {
  const C = useC();
  const T0 = +pts[0].d, T1 = Math.max(+(ahead.length ? ahead[ahead.length - 1].d : pts[pts.length - 1].d), T0 + 864e5), today = pts[pts.length - 1].d;
  const gap = ahead.length ? (+ahead[ahead.length - 1].d - +today) / (T1 - T0) : 0;
  const at = ((+today - T0) / (T1 - T0)) * w;
  const st = { position: "absolute", top: 0 };
  return (
    <View style={{ height: 16, marginTop: 6 }}>
      <T s={11.5} lh={15} c={C.ink3} style={[st, { left: 0 }]}>{E.fmt(pts[0].d)}</T>
      {ahead.length && gap >= 0.22 && w ? <T s={11.5} lh={15} c={C.ink3} style={[st, gap < 0.36 ? { right: w - at } : { left: at - 30, width: 60, textAlign: "center" }]}>Today</T> : null}
      <T s={11.5} lh={15} c={C.ink3} style={[st, { right: 0 }]}>{ahead.length ? "Payday " + E.fmt(ahead[ahead.length - 1].d) : "Today"}</T>
    </View>
  );
}

/** Categories as a ring that sweeps round once, slice after slice (150 px). */
export function Donut({ cats, total, size = 150, delay = 0 }) {
  const C = useC();
  const r = 42, Cc = 2 * Math.PI * r, gap = cats.length > 1 ? 1.6 : 0;
  const [k, setK] = useState(motionOn() ? 0 : 1);
  useEffect(() => { if (motionOn()) return frames({ ease: (t) => t, duration: 900 }, (t) => setK(t), delay + 80); }, []);
  let off = 0, swept = 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 4, marginBottom: 6 }}>
      <Breathe style={{ position: "absolute" }}><Svg width={size} height={size} viewBox="0 0 120 120">
        <Circle cx={60} cy={60} r={r} fill="none" stroke={C.inset2} strokeWidth={16} />
        {cats.map((c, i) => {
          const len = Math.max(0, (c.amt / total) * Cc - gap);
          const start = swept / Cc; swept += (c.amt / total) * Cc;
          const end = swept / Cc;
          const vis = Math.max(0, Math.min(1, (k - start) / Math.max(1e-6, end - start)));
          const el = vis > 0 ? <Circle key={i} cx={60} cy={60} r={r} fill="none" stroke={catHue(c.name)} strokeWidth={16} strokeDasharray={(len * vis).toFixed(2) + " " + (Cc - len * vis).toFixed(2)}
            strokeDashoffset={(-off).toFixed(2)} transform="rotate(-90 60 60)" /> : null;
          off += (c.amt / total) * Cc;
          return el;
        })}
      </Svg></Breathe>
      <T f={F.tile} s={22} lh={26}>{cats.length}</T>
      <T s={12} lh={14} c={C.ink3}>{cats.length === 1 ? "category" : "categories"}</T>
    </View>
  );
}

/** Six months of spending as bars that grow in turn, with the average as a dashed line; tap a month to see it. */
export function Trend({ s, onPick, delay = 0 }) {
  const C = useC();
  const max = Math.max.apply(null, s.six.map((x) => x.amt).concat([s.avg || 0, 1])) * 1.18;
  const H = 150;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ height: H, flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        {s.six.map((x, i) => <TrendBar key={x.ym} x={x} max={max} H={H} i={i} delay={delay} onPick={onPick} />)}
        {s.avg ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: (s.avg / max) * H, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: C.ink3, opacity: 0.8 }} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        {s.six.map((x) => <T key={x.ym} f={x.cur ? F.bold : F.body} s={12.5} lh={16} c={x.cur ? C.ink : C.ink3} style={{ flex: 1, textAlign: "center" }}>{E.ymName(x.ym, true)}</T>)}
      </View>
    </View>
  );
}
function TrendBar({ x, max, H, i, delay, onPick }) {
  const C = useC();
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  useEffect(() => { if (motionOn()) enter(v, S.grow, { delay: delay + 60 + i * 45 }); }, []);
  const bh = Math.max(2, (x.amt / max) * H);
  return (
    <Press onPress={() => onPick(x.ym)} scale={0.96} style={{ flex: 1, height: H, justifyContent: "flex-end", alignItems: "center" }} accessibilityLabel={E.ymName(x.ym) + (hidden() ? "" : ": " + E.money(x.amt))}>
      <View style={{ width: "100%", maxWidth: 46, height: bh, alignSelf: "center" }}>
        <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bh, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
          backgroundColor: x.cur ? C.accent : C.inset2, overflow: "hidden", transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [bh / 2, 0] }) }, { scaleY: v }] }}>
          <Sheen w={46} h={bh} up strength={0.5} every={4400} delay={i * 220} id="tr" />
        </Animated.View>
        <M text={x.amt ? compact(x.amt) : "—"} f={F.semi} s={12} c={x.cur ? C.ink : C.ink2} style={{ position: "absolute", bottom: bh + 4, left: -20, right: -20, textAlign: "center" }} />
      </View>
    </Press>
  );
}

/** A ring for a goal's progress (52 px), filling once. */
export function Ring({ pct, color, size = 52, delay = 0 }) {
  const C = useC();
  const r = 20, Cc = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct)) / 100;
  const [k, setK] = useState(motionOn() ? 0 : 1);
  useEffect(() => { if (motionOn()) return frames({ ease: (t) => 1 - Math.pow(1 - t, 3), duration: 1000 }, (t) => setK(t), delay + 80); }, []);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Breathe style={{ position: "absolute" }}><Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle cx={24} cy={24} r={r} fill="none" stroke={C.inset2} strokeWidth={5} />
        <Circle cx={24} cy={24} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={Cc.toFixed(2)} strokeDashoffset={(Cc * (1 - p * k)).toFixed(2)} transform="rotate(-90 24 24)" />
      </Svg></Breathe>
      <T f={F.bold} s={12} lh={15}>{Math.round(pct) + "%"}</T>
    </View>
  );
}
