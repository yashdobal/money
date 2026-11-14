/* The Money app's icons (icon-paths.js), drawn with react-native-svg: 24×24, a 1.7 stroke,
   round ends. The tab icons come in parts that each get their own flourish when chosen (app.css: the sun turns,
   the knobs slide, the card flips, the bars rise, the lines slide in, the plane takes off). */
import React, { useEffect, useRef, useState } from "react";
import Svg, { Path, Circle, Rect, Ellipse, G } from "react-native-svg";
import { P } from "./icon-paths";
import { S, frames, motionOn } from "./motion";
import RAnimated, { useSharedValue, useAnimatedProps, withSpring } from "react-native-reanimated";

const cache = {};
/** The SVG text as a small tree: [{tag, a: attributes, kids}] */
function parse(src) {
  if (cache[src]) return cache[src];
  const rootN = { kids: [] }, stack = [rootN];
  const re = /<(\/?)(path|circle|rect|ellipse|g)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) { stack.pop(); continue; }
    const a = {};
    m[3].replace(/([\w-]+)="([^"]*)"/g, (x, k, v) => { a[k] = v; return x; });
    const node = { tag: m[2], a, kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (m[2] === "g" && !m[4]) stack.push(node);
  }
  return (cache[src] = rootN.kids);
}
const num = (v) => (v === undefined ? undefined : parseFloat(v));

/* where each animated part turns or grows from (CSS transform-box: fill-box; origin centre, bars from the bottom) */
const ORIGIN = { "p-rays": [12, 12], "p-sun": [12, 12], "p-k1": [15, 7], "p-k2": [9, 17], "p-card": [12, 12],
  "p-b1": [5, 20], "p-b2": [10, 20], "p-b3": [15, 20], "p-b4": [20, 20], "p-l1": [4, 6], "p-l2": [4, 12], "p-l3": [4, 18] };
/** A part's transform at progress k (0 = the start of its flourish, 1 = at rest). */
function partTransform(cls, k) {
  if (!cls || k >= 1) return null;
  const [ox, oy] = ORIGIN[cls] || [12, 12];
  const around = (inner) => "translate(" + ox + " " + oy + ") " + inner + " translate(" + -ox + " " + -oy + ")";
  const lerp = (a, b) => a + (b - a) * k;
  if (cls === "p-rays") return { t: around("rotate(" + lerp(-90, 0) + ") scale(" + lerp(0.55, 1) + ")"), o: lerp(0.3, 1) };
  if (cls === "p-sun") return { t: around("scale(" + lerp(0.55, 1) + ")") };
  if (cls === "p-k1") return { t: "translate(" + lerp(-7, 0) + " 0)" };
  if (cls === "p-k2") return { t: "translate(" + lerp(7, 0) + " 0)" };
  if (cls === "p-card") return { t: around("scale(" + lerp(-1, 1) + " 1)") };
  if (/^p-b/.test(cls)) return { t: around("scale(1 " + lerp(0.15, 1) + ")") };
  if (/^p-l/.test(cls)) return { t: "translate(" + lerp(-6, 0) + " 0)", o: k };
  if (cls === "p-plane") return { t: "translate(" + lerp(-6, 0) + " " + lerp(6, 0) + ") " + around("scale(" + lerp(0.6, 1) + ")") };
  return null;
}
/* the stagger between parts (app.css animation-delay) */
const DELAY = { "p-k2": 40, "p-b2": 45, "p-b3": 90, "p-b4": 135, "p-l2": 55, "p-l3": 110 };

function draw(nodes, color, sw, prog, key) {
  return nodes.map((n, i) => {
    const a = n.a, cls = a.class, k = prog ? prog(cls) : 1, tr = partTransform(cls, k);
    const common = { key: key + "-" + i, stroke: color, strokeWidth: sw, fill: "none", strokeLinecap: "round", strokeLinejoin: "round",
      strokeDasharray: a["stroke-dasharray"], opacity: tr && tr.o !== undefined ? Math.max(0, Math.min(1, tr.o)) : undefined, transform: tr ? tr.t : undefined };
    if (n.tag === "path") return <Path {...common} d={a.d} />;
    if (n.tag === "circle") return <Circle {...common} cx={num(a.cx)} cy={num(a.cy)} r={num(a.r)} />;
    if (n.tag === "rect") return <Rect {...common} x={num(a.x)} y={num(a.y)} width={num(a.width)} height={num(a.height)} rx={num(a.rx)} />;
    if (n.tag === "ellipse") return <Ellipse {...common} cx={num(a.cx)} cy={num(a.cy)} rx={num(a.rx)} ry={num(a.ry)} />;
    if (n.tag === "g") {
      const kk = prog ? prog(cls) : 1, t2 = partTransform(cls, kk);
      return <G key={key + "-" + i} transform={t2 ? t2.t : undefined} opacity={t2 && t2.o !== undefined ? t2.o : undefined}>{draw(n.kids, color, sw, prog, key + "-" + i)}</G>;
    }
    return null;
  });
}

/** An icon by name (a category name works too). */
export function Icon({ name, size = 20, color, sw = 1.7, style }) {
  const src = P[name] || P.Other;
  return <Svg width={size} height={size} viewBox="0 0 24 24" style={style} pointerEvents="none">{draw(parse(src), color || "#000", sw, null, name)}</Svg>;
}

/** A tab's icon: its flourish plays each time it becomes the chosen tab (the icon spring, 700 / 0.42). */
export function TabIcon({ name, on, size = 23, color }) {
  const [t, setT] = useState(1);              // ms since the flourish started, normalised by the spring's length
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current && motionOn()) return frames({ ease: (k) => k, duration: S.icon.duration + 140 }, (k, raw) => setT(raw));
    was.current = on;
  }, [on]);
  useEffect(() => { was.current = on; });
  const total = S.icon.duration + 140;
  const prog = t >= 1 ? null : (cls) => {
    if (!cls) return 1;
    const ms = t * total - (DELAY[cls] || 0);
    if (ms <= 0) return 0;
    if (/^p-l/.test(cls)) { const k = Math.min(1, ms / 420); return 1 - Math.pow(1 - k, 3); }   // lines: 420 ms, ease out
    return S.icon.ease(Math.min(1, ms / S.icon.duration));
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: "visible" }} pointerEvents="none">{draw(parse(P[name]), color, on ? 2 : 1.7, prog, name)}</Svg>;
}

/* ---------------- the eye that closes ---------------- */
/** Hide amounts: the eye's iris shrinks into the lid as a slash draws across it; showing them again reverses it
    (on the icon spring, on the graphics thread). */
const AG = RAnimated.createAnimatedComponent(G), APath = RAnimated.createAnimatedComponent(Path), ACircle = RAnimated.createAnimatedComponent(Circle);
const SLASH = 22.63;
export function EyeIcon({ off, size = 21, color, sw = 1.9 }) {
  const v = useSharedValue(off ? 1 : 0);
  useEffect(() => {
    if (!motionOn()) { v.value = off ? 1 : 0; return; }
    v.value = withSpring(off ? 1 : 0, { stiffness: 700, damping: 2 * 0.62 * Math.sqrt(700), mass: 1 });
  }, [off]);
  const openP = useAnimatedProps(() => ({ opacity: Math.max(0, 1 - v.value * 1.6) }));
  const shutP = useAnimatedProps(() => ({ opacity: Math.min(1, Math.max(0, v.value * 1.6 - 0.3)) }));
  const iris = useAnimatedProps(() => ({ r: Math.max(0, 3 * (1 - v.value)), opacity: 1 - Math.min(1, v.value) }));
  const slash = useAnimatedProps(() => ({ strokeDashoffset: SLASH * (1 - Math.min(1, Math.max(0, v.value))) }));
  const st = { stroke: color, strokeWidth: sw, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      <AG animatedProps={openP}><Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...st} /></AG>
      <ACircle cx={12} cy={12} animatedProps={iris} {...st} />
      <AG animatedProps={shutP}><Path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.4 7.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2" {...st} /></AG>
      <APath d="M4 4l16 16" {...st} strokeDasharray={[SLASH, SLASH]} animatedProps={slash} />
    </Svg>
  );
}
