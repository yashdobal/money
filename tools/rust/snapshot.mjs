// The current engine's figures (engine.js snapshot()) on the demo data, at each moment given, for the Rust parity
// check (rust/core/tests/parity.rs). Run with TZ=Asia/Kolkata: node tools/rust/snapshot.mjs <ms> [<ms> …]
// Prints one JSON array: [{at, snap}, …]. Needs node tools/rn_engine.mjs first (rn/src/engine.gen.js).
import fs from "fs";
import path from "path";
import url from "url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const { frozenDate } = await import(path.join(ROOT, "supabase/functions/_shared/ist-date.js"));
const { makeEngine } = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const { screensOf } = await import(path.join(ROOT, "tools/rust/screens.mjs"));
const RealDate = Date;
const out = [];
for (const a of process.argv.slice(2)) {
  const at = Number(a);
  globalThis.Date = frozenDate(() => at);
  const store = {};
  const e = makeEngine({
    window: { MONEY: { serverCall: async () => ({ ok: true }) }, UI: {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { hidden: true, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
  });
  e.ingest(e.shapeData({ tx: F.transactions, emails: F.card_emails, pays: F.card_payments, goals: F.goals, contribs: F.goal_contributions, rules: F.rules,
    settings: F.settings, edits: e.shapeEdits(F.payee_rules, F.txn_notes), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at }));
  const snap = e.snapshot();
  const screens = screensOf(e);
  // what the server sends: the widget's numbers (less the moment it was made) and the 9 PM summary
  const widget = e.widgetModel(); delete widget.at;
  out.push({ at, snap, screens, server: { widget, digest: e.digestModel() } });
  globalThis.Date = RealDate;
}
process.stdout.write(JSON.stringify(out));
