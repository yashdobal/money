// The current engine (engine.js act.*) making the changes in tools/rust/actions.json on the demo data, for the Rust
// check (rust/core/tests/actions.rs). After each change: what it returned, the settings it saves (pushSettings), the
// writes to the notes and rules tables, and every figure (snapshot). Run with TZ=Asia/Kolkata.
import fs from "fs";
import path from "path";
import url from "url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/rust/actions.json"), "utf8"));
const { frozenDate } = await import(path.join(ROOT, "supabase/functions/_shared/ist-date.js"));
const { makeEngine } = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const { screensOf } = await import(path.join(ROOT, "tools/rust/screens.mjs"));

const at = Date.parse(S.at);
let now = at;
globalThis.Date = frozenDate(() => now);
let blob = null, writes = [];
const store = {};
const e = makeEngine({
  window: {
    MONEY: {
      serverCall: async (name, arg) => { if (name === "saveSettings") blob = JSON.parse(JSON.stringify(arg)); return { ok: true }; },
      saveRule: (pattern, category) => { writes.push({ t: "rule", pattern, category }); },
      deleteRule: (pattern) => { writes.push({ t: "unrule", pattern }); },
      saveNote: (ref, row) => { writes.push({ t: "note", ref, row: row ? JSON.parse(JSON.stringify(row)) : null }); },
    },
    UI: {},
  },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { hidden: true, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
});
e.ingest(e.shapeData({ tx: F.transactions, emails: F.card_emails, pays: F.card_payments, goals: F.goals, contribs: F.goal_contributions, rules: F.rules,
  settings: F.settings, edits: e.shapeEdits(F.payee_rules, F.txn_notes), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at }));

const merge = (a, b) => { const o = JSON.parse(JSON.stringify(a)); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && o[k] && typeof o[k] === "object" ? merge(o[k], b[k]) : b[k]; return o; };
const fill = (v) => {
  if (typeof v === "string") return v === "$profile" ? JSON.parse(JSON.stringify(e.PROFILE)) : v.replace(/\$t(\d+)/g, (m, n) => String(at + Number(n) * 1000));
  if (Array.isArray(v)) return v.map(fill);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = fill(v[k]); return o; }
  return v;
};
const out = [];
S.steps.forEach((step, i) => {
  now = at + i * 1000;
  const [name, ...args0] = step;
  const args = fill(args0);
  let ret;
  if (name === "setProfile") ret = e.act.setProfile(merge(e.PROFILE, args[0].merge));
  else if (name === "override") { e.overrides[args[0]] = args[1]; e.render(); }
  else ret = e.act[name](...args);
  e.pushSettings();
  out.push({ step: i, name, ret: typeof ret === "string" ? ret : null, blob, writes, snap: e.snapshot(), screens: screensOf(e) });
  writes = [];
});
// (the engine's save timers would keep node running: stop once everything is written)
process.stdout.write(JSON.stringify(out), () => process.exit(0));
