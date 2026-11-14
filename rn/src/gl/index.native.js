/* Money RN · the graphics engine (Skia, on the phone's GPU; Reanimated runs the motion on the graphics thread).
   - HeroField: the Safe to spend card's living colour field: slow flowing light (a domain-warped noise shader) over the
     card's gradient, a highlight drifting along the top, a fine grain, and a glow that follows your finger.
   - CoinRain: payday coins with real physics: they fall, bounce off the floor and the walls, knock into each other,
     roll, and pile up on the bottom of the card before fading.
   - BurstLayer / burst(): a confetti burst over everything (a card bill fully paid, a goal reached).
   - CardLight: light on a card: a soft highlight that follows your finger as you tilt it, with a band of iridescence.
   On the web preview this file isn't used (index.js there draws the older SVG versions). */
import React, { useEffect, useState } from "react";
import { Dimensions, View } from "react-native";
import { Canvas, Fill, Shader, Skia, Picture, createPicture, useClock } from "@shopify/react-native-skia";
import { useSharedValue, useDerivedValue, useFrameCallback, withSpring, withTiming, makeMutable, runOnJS } from "react-native-reanimated";
import { useC } from "../theme";
import { live } from "../live";
import { buzz } from "../kit";

export const GL = true;

/** "#RRGGBB" or "rgba(r,g,b,a)" → [r, g, b, a] in 0..1, for shader uniforms. */
function v4(c) {
  const s = String(c || "#000000").trim();
  if (s[0] === "#") { const h = s.length === 4 ? s.slice(1).split("").map((x) => x + x).join("") : s.slice(1, 7); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat([1]); }
  const m = s.match(/[\d.]+/g) || [0, 0, 0, 1];
  return [m[0] / 255, m[1] / 255, m[2] / 255, m[3] !== undefined ? +m[3] : 1];
}

/* ---------------- the living hero ---------------- */
const HERO = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float t;
uniform float2 touch;
uniform float touchOn;
uniform float4 colA;
uniform float4 colB;
uniform float4 glow;
uniform float amt;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + float2(1.7, 9.2); a *= 0.5; }
  return v;
}
half4 main(float2 xy) {
  float2 uv = xy / res;
  float asp = res.x / res.y;
  float g = clamp(dot(uv - float2(0.15, 0.0), normalize(float2(0.45, 1.0))), 0.0, 1.0);
  float3 col = mix(colA.rgb, colB.rgb, g);
  float2 p = float2(uv.x * asp, uv.y) * 1.5;
  float2 q = float2(fbm(p + float2(0.0, t * 0.045)), fbm(p + float2(5.2, 1.3) - float2(t * 0.035, 0.0)));
  float n = fbm(p + 1.9 * q + float2(t * 0.02, -t * 0.015));
  float silk = smoothstep(0.48, 0.86, n);
  col += glow.rgb * silk * amt;
  float2 c1 = float2(0.78 + 0.16 * sin(t * 0.09), 0.12 + 0.12 * cos(t * 0.07));
  float2 d1 = (uv - c1) * float2(asp, 1.0);
  col += glow.rgb * amt * 1.1 * exp(-dot(d1, d1) * 2.6);
  float2 dt = (uv - touch / res) * float2(asp, 1.0);
  col += glow.rgb * touchOn * 0.24 * exp(-dot(dt, dt) * 7.0);
  col += (hash(xy * 0.5 + float2(fract(t * 0.37) * 91.0, 0.0)) - 0.5) * 0.016;
  return half4(half3(col), 1.0);
}`);

export const heroX = makeMutable(0), heroY = makeMutable(0), heroOn = makeMutable(0);
/** A finger on the card: the glow eases toward it. */
export function heroTouchGL(x, y) {
  if (heroOn.value < 0.05) { heroX.value = x; heroY.value = y; }
  else { heroX.value = withSpring(x, { stiffness: 90, damping: 16 }); heroY.value = withSpring(y, { stiffness: 90, damping: 16 }); }
  heroOn.value = withTiming(1, { duration: 200 });
}
export function heroLeaveGL() { heroOn.value = withTiming(0, { duration: 900 }); }

export function HeroField({ w, h }) {
  const C = useC();
  // its own clock, which only runs while Today is the screen showing (and the app is open)
  const clock = useSharedValue(0);
  useFrameCallback((f) => { "worklet"; if (live.today.value) clock.value += Math.min(64, f.timeSincePreviousFrame || 16); });
  const colA = v4(C.heroA), colB = v4(C.heroB), glow = v4(C.heroGlow), amt = C.palette === "minimal" ? 0.085 : 0.15;
  const uniforms = useDerivedValue(() => ({ res: [w, h], t: 24 + clock.value / 1000, touch: [heroX.value, heroY.value], touchOn: heroOn.value, colA, colB, glow, amt }), [w, h, C]);
  if (!HERO) return null;
  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <Fill><Shader source={HERO} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}

/* ---------------- coins with physics ---------------- */
/** The rupee sign as strokes, centred on 0,0 for a 13 px coin. */
const RUPEE = "M-4.2 -6.2H4.6M-4.2 -2.6H4.6M-1.4 -6.2C3.4 -6.2 3.4 0.6 -1.6 0.6H-4.2L2.8 7";

export function CoinRain({ n, w, h, tone, onDone }) {
  const st = useSharedValue(null);
  useEffect(() => {
    const R = 13, c = { x: [], y: [], vx: [], vy: [], a: [], va: [], r: [], t: 0, hit: 0, done: 0, life: 2.6 + n * 0.05 };
    for (let i = 0; i < n; i++) {
      const r = R * (0.88 + Math.random() * 0.26);
      c.x.push(r + Math.random() * (w - 2 * r)); c.y.push(-r - i * 34 - Math.random() * 30);
      c.vx.push((Math.random() - 0.5) * 140); c.vy.push(80 + Math.random() * 120);
      c.a.push(Math.random() * 6.28); c.va.push((Math.random() - 0.5) * 8); c.r.push(r);
    }
    st.value = c;
  }, []);
  const heavy = () => buzz("heavy"), end = () => onDone && onDone();
  useFrameCallback((info) => {
    "worklet";
    st.modify((s) => {
      "worklet";
      if (!s || s.done) return s;
      const all = Math.min(0.12, (info.timeSincePreviousFrame || 16) / 1000), steps = Math.max(1, Math.ceil(all / 0.017)), dt = all / steps;
      const G = 2300, E = 0.36, N = s.x.length;
      for (let step = 0; step < steps; step++) {
      s.t += dt;
      for (let i = 0; i < N; i++) {
        const r = s.r[i];
        s.vy[i] += G * dt; s.vx[i] *= 1 - 0.25 * dt;
        s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; s.a[i] += s.va[i] * dt;
        const floor = h - r - 3;
        if (s.y[i] > floor) {
          s.y[i] = floor;
          if (s.vy[i] > 0) { if (!s.hit && s.vy[i] > 300) { s.hit = 1; runOnJS(heavy)(); } s.vy[i] = -s.vy[i] * E; if (Math.abs(s.vy[i]) < 45) s.vy[i] = 0; }
          s.vx[i] *= 0.9; s.va[i] = s.vx[i] / r;                       // rolling on the floor
        }
        if (s.x[i] < r) { s.x[i] = r; s.vx[i] = -s.vx[i] * E; }
        if (s.x[i] > w - r) { s.x[i] = w - r; s.vx[i] = -s.vx[i] * E; }
      }
      for (let it = 0; it < 3; it++) {                                  // coins knock into each other and stack
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], rr = s.r[i] + s.r[j], d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-4) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (rr - d) / 2;
          s.x[i] -= nx * push; s.y[i] -= ny * push; s.x[j] += nx * push; s.y[j] += ny * push;
          const vn = (s.vx[j] - s.vx[i]) * nx + (s.vy[j] - s.vy[i]) * ny;
          if (vn < 0) {
            const k = (-(1 + E) * vn) / 2;
            s.vx[i] -= k * nx; s.vy[i] -= k * ny; s.vx[j] += k * nx; s.vy[j] += k * ny;
            s.va[i] += (k * ny) / s.r[i] * 0.3; s.va[j] -= (k * ny) / s.r[j] * 0.3;
          }
        }
      }
      }
      if (s.t > s.life + 0.7) { s.done = 1; runOnJS(end)(); }
      return s;
    }, true);
  });
  const light = "#FFFFFF", dark = "#00000059";
  const pic = useDerivedValue(() => createPicture((canvas) => {
    const s = st.value;
    if (!s) return;
    const alpha = s.t > s.life ? Math.max(0, 1 - (s.t - s.life) / 0.6) : 1;
    const fill = Skia.Paint(); fill.setAntiAlias(true);
    const rim = Skia.Paint(); rim.setAntiAlias(true); rim.setStyle(1); rim.setStrokeWidth(1); rim.setColor(Skia.Color("rgba(0,0,0,0.2)")); rim.setAlphaf(0.2 * alpha);
    const glyph = Skia.Paint(); glyph.setAntiAlias(true); glyph.setStyle(1); glyph.setStrokeWidth(1.7); glyph.setStrokeCap(1); glyph.setStrokeJoin(1); glyph.setColor(Skia.Color("rgba(20,20,20,0.6)")); glyph.setAlphaf(0.6 * alpha);
    const path = Skia.Path.MakeFromSVGString(RUPEE);
    const shadow = Skia.Paint(); shadow.setAntiAlias(true); shadow.setColor(Skia.Color("black")); shadow.setAlphaf(0.18 * alpha);
    for (let i = 0; i < s.x.length; i++) {
      const r = s.r[i];
      canvas.drawOval(Skia.XYWHRect(s.x[i] - r * 0.8, h - 5, r * 1.6, 4), shadow);
    }
    for (let i = 0; i < s.x.length; i++) {
      const r = s.r[i];
      canvas.save();
      canvas.translate(s.x[i], s.y[i]);
      canvas.rotate((s.a[i] * 180) / Math.PI, 0, 0);
      fill.setShader(Skia.Shader.MakeRadialGradient({ x: -r * 0.35, y: -r * 0.4 }, r * 1.55, [Skia.Color(light), Skia.Color(tone), Skia.Color(dark)], [0, 0.42, 1], 0));
      fill.setAlphaf(alpha);
      canvas.drawCircle(0, 0, r, fill);
      canvas.drawCircle(0, 0, r - 3, rim);
      if (path) { canvas.save(); canvas.scale(r / 13, r / 13); canvas.drawPath(path, glyph); canvas.restore(); }
      canvas.restore();
    }
  }));
  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <Picture picture={pic} />
    </Canvas>
  );
}

/* ---------------- confetti ---------------- */
let fire = null;
/** kind: "paid" (a card bill fully paid) or "goal" (a goal reached). at: {x, y} on the screen, or the middle. */
export function burst(kind, at) { if (fire) fire(kind, at); }

export function BurstLayer() {
  const [b, setB] = useState(null);
  useEffect(() => { fire = (kind, at) => setB({ kind, at: at || null, k: Date.now() }); return () => { fire = null; }; }, []);
  if (!b) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 65 }}>
      <Confetti key={b.k} kind={b.kind} at={b.at} onDone={() => setB(null)} />
    </View>
  );
}

function Confetti({ kind, at, onDone }) {
  const C = useC();
  const { width: W, height: H } = Dimensions.get("window");
  const st = useSharedValue(null);
  useEffect(() => {
    buzz("confirm");
    const ox = at ? at.x : W / 2, oy = at ? at.y : H * 0.62;
    const cols = kind === "goal" ? [C.pos, C.accent, "#E9C46A", C.nSip, C.nEf, "#FFFFFF"] : [C.accent, C.pos, "#E9C46A", C.nFamily, C.info, "#FFFFFF"];
    const s = { x: [], y: [], vx: [], vy: [], a: [], va: [], w: [], h: [], ph: [], vp: [], c: [], round: [], t: 0, done: 0 };
    const N = 90;
    for (let i = 0; i < N; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.1, sp = 650 + Math.random() * 900;
      s.x.push(ox + (Math.random() - 0.5) * 30); s.y.push(oy);
      s.vx.push(Math.cos(ang) * sp); s.vy.push(Math.sin(ang) * sp);
      s.a.push(Math.random() * 6.28); s.va.push((Math.random() - 0.5) * 14);
      const round = Math.random() < 0.22;
      s.w.push(round ? 6 : 7 + Math.random() * 6); s.h.push(round ? 6 : 4 + Math.random() * 3);
      s.ph.push(Math.random() * 6.28); s.vp.push(6 + Math.random() * 10);
      s.c.push(cols[i % cols.length]); s.round.push(round ? 1 : 0);
    }
    st.value = s;
  }, []);
  const end = () => onDone();
  useFrameCallback((info) => {
    "worklet";
    st.modify((s) => {
      "worklet";
      if (!s || s.done) return s;
      const dt = Math.min(0.1, (info.timeSincePreviousFrame || 16) / 1000);
      s.t += dt;
      const drag = Math.exp(-1.9 * dt);
      for (let i = 0; i < s.x.length; i++) {
        s.vy[i] += 1500 * dt; s.vx[i] *= drag; s.vy[i] *= drag;
        if (s.vy[i] > 260) s.vy[i] = 260 + (s.vy[i] - 260) * 0.9;     // flat pieces flutter down slowly
        s.x[i] += (s.vx[i] + Math.sin(s.ph[i]) * 40) * dt; s.y[i] += s.vy[i] * dt;
        s.a[i] += s.va[i] * dt; s.ph[i] += s.vp[i] * dt;
      }
      if (s.t > 3) { s.done = 1; runOnJS(end)(); }
      return s;
    }, true);
  });
  const pic = useDerivedValue(() => createPicture((canvas) => {
    const s = st.value;
    if (!s) return;
    const alpha = s.t > 2.3 ? Math.max(0, 1 - (s.t - 2.3) / 0.7) : 1;
    const p = Skia.Paint(); p.setAntiAlias(true);
    for (let i = 0; i < s.x.length; i++) {
      p.setColor(Skia.Color(s.c[i])); p.setAlphaf(alpha);
      canvas.save();
      canvas.translate(s.x[i], s.y[i]);
      canvas.rotate((s.a[i] * 180) / Math.PI, 0, 0);
      canvas.scale(1, Math.cos(s.ph[i]));                               // turning over as it falls
      if (s.round[i]) canvas.drawCircle(0, 0, s.w[i] / 2, p);
      else canvas.drawRect(Skia.XYWHRect(-s.w[i] / 2, -s.h[i] / 2, s.w[i], s.h[i]), p);
      canvas.restore();
    }
  }));
  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
      <Picture picture={pic} />
    </Canvas>
  );
}

/* ---------------- light on a card ---------------- */
const CARD = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float2 light;
uniform float on;
half4 main(float2 xy) {
  float2 uv = xy / res;
  float2 L = light / res;
  float asp = res.x / res.y;
  float2 d = (uv - L) * float2(asp, 1.0);
  float spec = exp(-dot(d, d) * 5.5) * (0.07 + 0.26 * on);
  float k = dot(uv - L, normalize(float2(1.0, -0.62)));
  float band = exp(-k * k * 26.0) * (0.03 + 0.15 * on);
  float3 iri = 0.5 + 0.5 * cos(6.2831 * (k * 1.7 + uv.y * 0.4 + float3(0.0, 0.33, 0.67)));
  float a = clamp(spec + band, 0.0, 1.0);
  return half4(half3(float3(spec) + iri * band), half(a));
}`);

/** lx, ly: where the light is on the card (px); on: 0 resting, 1 under your finger. */
export function CardLight({ w, h, lx, ly, on }) {
  const uniforms = useDerivedValue(() => ({ res: [w, h], light: [lx.value, ly.value], on: on.value }), [w, h]);
  if (!CARD || !w) return null;
  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
      <Fill><Shader source={CARD} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}
