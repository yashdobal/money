// Usage: node tools/motion/spring.js  → prints the CSS linear() curves used as --spring-* in app/app.css
// Damped spring from 0 → 1, sampled into CSS linear(). Prints settle time (ms) and the curve.
function spring(k, c, m = 1) {
  let x = 0, v = 0; const dt = 1 / 1000, pts = []; let t = 0, settled = 0;
  while (t < 3) {
    const a = (-k * (x - 1) - c * v) / m; v += a * dt; x += v * dt; t += dt;
    pts.push([t, x]);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) { if (!settled) settled = t; } else settled = 0;
    if (settled && t - settled > 0.02) break;
  }
  const T = pts[pts.length - 1][0], N = 36, out = [];
  for (let i = 0; i <= N; i++) { const ti = T * i / N; const p = pts.reduce((b, q) => Math.abs(q[0] - ti) < Math.abs(b[0] - ti) ? q : b); out.push(+p[1].toFixed(3)); }
  out[out.length - 1] = 1;
  const peak = Math.max(...pts.map(p => p[1]));
  return { ms: Math.round(T * 1000), overshoot: +(peak - 1).toFixed(3), css: "linear(" + out.join(", ") + ")" };
}
for (const [name, k, c] of [["soft", 260, 32], ["snappy", 420, 30], ["bouncy", 300, 20]]) {
  const s = spring(k, c); console.log(name, s.ms + "ms", "overshoot", s.overshoot); console.log("  " + s.css);
}
