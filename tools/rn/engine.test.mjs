// The React Native app's engine (rn/src/engine.gen.js) against the server's copy (supabase/functions/_shared/engine.gen.js):
// same demo rows in, same figures out. Both are generated from app/engine.js, so this checks the generation and the
// RN wrapper (live getters, storage, hooks), not the maths itself.
import fs from "fs";
import path from "path";
import url from "url";
import assert from "assert";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const rn = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const server = await import(path.join(ROOT, "supabase/functions/_shared/engine.gen.js"));

const rows = (shapeEdits) => ({
  tx: F.transactions, emails: F.card_emails, pays: F.card_payments,
  goals: F.goals, contribs: F.goal_contributions, rules: F.rules, settings: F.settings,
  edits: shapeEdits(F.payee_rules, F.txn_notes), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at,
});

const store = {}, renders = [];
const e = rn.makeEngine({
  window: { MONEY: { serverCall: async () => ({ ok: true }) }, UI: { render: (o) => renders.push(o || {}) } },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { hidden: false, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
});
const s = server.makeEngine({ Date });

const a = e.shapeData(rows(e.shapeEdits)), b = s.shapeData(rows(s.shapeEdits));
assert.deepStrictEqual({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 }, "shapeData differs");
e.ingest(a); s.ingest(b);
const wa = e.widgetModel(), wb = s.widgetModel();
delete wa.at; delete wb.at;
assert.deepStrictEqual(wa, wb, "widgetModel differs");
assert.deepStrictEqual(e.digestModel(), s.digestModel(), "digestModel differs");

// live getters: an action changes what the getters return, renders, and caches to storage
assert.ok(e.TX.length > 0, "no transactions");
const before = e.manual.length;
e.act.addManual({ t: "Test", amt: 120, c: "Food & dining", date: e.iso(e.sod(new Date())), acct: "cash" });
assert.strictEqual(e.manual.length, before + 1, "manual getter isn't live");
assert.ok(renders.length > 0, "no render hook");
const cards = e.allCards(), hero = e.heroModel(cards);
assert.ok(cards.length >= 1 && hero && hero.state, "cards/hero");
console.log("rn engine: same figures as the server · " + e.TX.length + " transactions · hero " + hero.state + " · " + cards.length + " cards");
