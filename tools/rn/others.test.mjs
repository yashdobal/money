// "Spent for someone else" on a card: they pay you back, so that part of the bill isn't yours to pay. The forecast,
// where you stand and the salary plan expect it back; a payback settles it rather than coming off your spending too.
// Run node tools/rn_engine.mjs first.
import fs from "fs";
import path from "path";
import url from "url";
import assert from "assert";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const rn = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const make = (notes, extraTx) => {
  const store = {};
  const e = rn.makeEngine({
    window: { MONEY: { serverCall: async () => ({ ok: true }) }, UI: { render() {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { hidden: false, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
  });
  e.ingest(e.shapeData({
    tx: F.transactions.concat(extraTx || []), emails: F.card_emails, pays: F.card_payments,
    goals: F.goals, contribs: F.goal_contributions, rules: F.rules, settings: F.settings,
    edits: e.shapeEdits(F.payee_rules, F.txn_notes.concat(notes || [])), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at,
  }));
  return e;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, msg + ": " + a + " ≠ " + b);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };

const base = make();
// the biggest card spend still unbilled on any card
const cards = base.allCards();
const open = base.TX.filter((t) => t.dir === "out" && base.CARD_CFG[t.account]).filter((t) => {
  const c = cards.find((c) => c.members.includes(t.account));
  return c && !c.preFirst && t.ts > c.c.stmt.getTime() + 864e5;
}).sort((a, b) => b.amt - a.amt)[0];
assert.ok(open, "the demo has an unbilled card spend");
const note = { txn_ref: open.id, category: null, for_someone_else: true, paid_back: false, note: "" };
const other = make([note]);

ok("the card still owes it, but it's expected back", () => {
  const c0 = base.allCards(), c1 = other.allCards();
  near(c1.reduce((s, c) => s + c.owed, 0), c0.reduce((s, c) => s + c.owed, 0), "the bank still bills it");
  const b = other.owedBack(c1);
  near(b.total, open.amt, "back from others");
});

ok("where you stand and the forecast go up by it", () => {
  near(other.netModel(other.allCards()).now - base.netModel(base.allCards()).now, open.amt, "where you stand");
  const f0 = base.forecast(base.allCards()), f1 = other.forecast(other.allCards());
  near(f1.end.bal - f0.end.bal, open.amt, "balance at the end of the window");
  const h = other.heroModel(other.allCards());
  assert.ok(h.rows.some((r) => r.title === "Back from others" && Math.abs(r.amt - open.amt) < 0.5), "a row in how it's worked out");
});

ok("a bill paid from a salary takes only your part", () => {
  for (let cyc = base.payCycle(), i = 0; i < 3; cyc = base.nextCycle(cyc), i++) {
    const a = base.monthPlan(cyc), b = other.monthPlan(cyc);
    const back = b.cards.reduce((s, c) => s + (c.back || 0), 0);
    near(a.cardsTotal - b.cardsTotal, back, "cards total less what comes back");
    near(b.spend - a.spend, back, "spending share");
  }
});

ok("money paid back settles it, and doesn't come off your spending as well", () => {
  const bank = F.transactions.find((t) => t.accounts && t.accounts.kind === "bank");
  const when = new Date(Date.now() - 3600e3);
  const pay = Object.assign({}, bank, { source_ref: "payback-test", direction: "in", amount: Math.round(open.amt * 100), description: "UPI from a friend",
    snippet: "UPI from a friend", occurred_at: when.toISOString(), categories: { name: "Money in" }, counted: false });
  const paid = make([note, { txn_ref: "payback-test", category: null, for_someone_else: false, paid_back: true, note: "" }], [pay]);
  near(paid.owedBack(paid.allCards()).total, 0, "nothing more to come back");
  const ym = paid.ymOf(new Date());
  const s = paid.spendModel(ym), s0 = other.spendModel(ym);
  near(s.spend, s0.spend, "spending unchanged by the payback");
});

console.log("\nall " + n + " passed");
