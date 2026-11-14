/**
 * The server runs the app's own engine (supabase/functions/_shared/engine.gen.js) for the widget and the 9 PM summary.
 * This checks it gives exactly the figures the app gives:
 *
 *   B. the server engine with the normal Date, on a computer set to India time
 *   C. the server engine with istDate(), on a computer set to UTC (as Supabase runs)
 *
 * B = C shows the time shift is exact, including the hours after midnight in India when it is still the day before in
 * UTC. Every section of snapshot(), the widget and the summary must match, at many moments. (That the app's engine is
 * the server's is tools/rn/engine.test.mjs.)
 *
 * Usage: node tools/engine/ist.test.mjs [real-data.json]   (engine.gen.js from node tools/rn_engine.mjs)
 *        A real data file stays outside the repo; without one it runs on the demo data only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rowsOf } from "./fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const GEN = path.join(ROOT, "supabase/functions/_shared/engine.gen.js");
const SHIM = path.join(ROOT, "supabase/functions/_shared/ist-date.js");

const at = (local) => Date.parse(local + "+05:30");        // "2026-12-08T19:30" India time → ms

/* ---------- child: print the figures for each moment ---------- */
async function child(side, file, moments) {
  const fx = JSON.parse(readFileSync(file, "utf8"));
  const { makeEngine } = await import(GEN);
  const { istDate, frozenDate } = await import(SHIM);
  const out = {};
  for (const m of moments) {
    const now = () => at(m);
    const E = makeEngine({ Date: side === "ist" ? istDate(now) : frozenDate(now) });
    E.ingest(E.shapeData(rowsOf(fx, E.shapeEdits)));
    out[m] = { snapshot: E.snapshot(), widget: E.widgetModel(), digest: E.digestModel() };
  }
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
}

/* ---------- parent ---------- */
function run(side, tz, file, moments) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", side, file, JSON.stringify(moments)],
    { env: { ...process.env, TZ: tz }, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(side + " failed:\n" + r.stderr);
  return JSON.parse(r.stdout);
}
function moments(from, to) {
  const out = [];
  const hours = ["00:10", "03:00", "05:20", "05:40", "09:00", "13:30", "19:30", "21:05", "23:55"];
  for (let t = Date.parse(from), i = 0; t <= Date.parse(to); t += 86400000 * 2, i++) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(day + "T" + hours[i % hours.length]);
  }
  return out;
}
function compare(label, a, b) {
  let fails = 0;
  for (const m of Object.keys(a)) {
    if (!b[m]) continue;
    for (const k of Object.keys(a[m])) {
      const x = JSON.stringify(a[m][k]), y = JSON.stringify(b[m][k]);
      if (x === y) continue;
      fails++;
      let i = 0; while (i < x.length && x[i] === y[i]) i++;
      console.log(`FAIL ${label} ${m} ${k}\n   one:   …${x.slice(Math.max(0, i - 80), i + 80)}\n   other: …${y.slice(Math.max(0, i - 80), i + 80)}`);
    }
  }
  return fails;
}

if (process.argv[2] === "--child") {
  await child(process.argv[3], process.argv[4], JSON.parse(process.argv[5]));
} else {
  const sets = [[path.join(ROOT, "tools/demo/demo-fixture.json"), "demo", moments("2026-11-24", "2027-01-08")]];
  if (process.argv[2]) sets.push([path.resolve(process.argv[2]), "real", moments("2026-10-12", "2026-11-28")]);
  let fails = 0;
  for (const [file, name, ms] of sets) {
    const ref = run("ref", "Asia/Kolkata", file, ms), ist = run("ist", "UTC", file, ms);
    const f1 = 0, f2 = compare(name + " india≠utc", ref, ist);
    const w = ref[ms[ms.length - 1]].widget;
    console.log(`${name}: ${ms.length} moments · India vs UTC ${f2 ? f2 + " differ" : "match"}` +
      ` · e.g. ${ms[ms.length - 1]}: ₹${w.daily} a day, ₹${w.left} left, ${w.curve ? w.curve.pts.length : 0} curve points`);
    fails += f1 + f2;
  }
  console.log(fails ? `${fails} DIFFERENCE(S)` : "ALL MATCH");
  process.exit(fails ? 1 : 0);
}
