// A card payment that was reversed or refunded (Activity → the payment → "This payment was reversed or refunded").
// Before its bill closed it's dropped from everything; after, the same amount comes back to the card today, off the
// next bill. Either way it can be undone. Run node tools/rn_engine.mjs first.
import fs from "fs";
import path from "path";
import url from "url";
import assert from "assert";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const rn = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const make = (settings) => {
  const store = {};
  const e = rn.makeEngine({
    window: { MONEY: { serverCall: async () => ({ ok: true }) }, UI: { render() {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { hidden: false, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
  });
  e.ingest(e.shapeData({
    tx: F.transactions, emails: F.card_emails, pays: F.card_payments, goals: F.goals, contribs: F.goal_contributions, rules: F.rules,
    settings: settings || F.settings, edits: e.shapeEdits(F.payee_rules, F.txn_notes), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at,
  }));
  e.resolvePayments();                     // as the first render does (the marks below re-render)
  return e;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, msg + ": " + a + " ≠ " + b);
const owed = (e) => e.allCards().reduce((s, c) => s + c.owed, 0);
const credit = (e) => e.allCards().reduce((s, c) => s + c.credit, 0);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };

const e = make();
const cardOf = (t) => e.allCards().find((c) => c.members.includes(t.account));
const spends = e.TX.filter((t) => t.dir === "out" && e.CARD_CFG[t.account] && e.txFor(t.ym).find((x) => x.id === t.id).counted);
const unbilled = spends.filter((t) => { const c = cardOf(t); return c && !c.preFirst && t.ts > c.c.stmt.getTime() + 864e5 - 1; }).sort((a, b) => b.amt - a.amt)[0];
const billed = spends.filter((t) => { const c = cardOf(t); return c && !c.preFirst && t.ts <= c.c.stmt.getTime() && t.ts > c.c.prevStmt.getTime() + 864e5; }).sort((a, b) => b.amt - a.amt)[0];
assert.ok(unbilled && billed, "the demo has a billed and an unbilled card spend");

ok("reversed before its bill: off the bill, spending and points, still listed so it can be undone", () => {
  const ym = unbilled.ym, owed0 = owed(e), spend0 = e.spendModel(ym).spend;
  const info = e.revInfo(unbilled.id);
  assert.ok(info && !info.billed && !info.gone && !info.on);
  assert.strictEqual(e.act.reverse(unbilled.id), "");
  assert.strictEqual(e.overrides["rev|" + unbilled.id], true);
  assert.ok(!e.TX.some((t) => t.id === unbilled.id), "gone from the figures");
  near(owed0 - owed(e), unbilled.amt, "the card owes less by it");
  near(spend0 - e.spendModel(ym).spend, unbilled.amt, "spending less by it");
  const row = e.allTx().find((x) => x.id === unbilled.id);
  assert.ok(row && row.reversed && !row.counted, "still in Activity, marked reversed");
  assert.ok(!e.rewMonth().some((h) => h.items && h.items.some((x) => x.id === unbilled.id)), "no points on it");
  e.act.unreverse(unbilled.id);
  assert.ok(!("rev|" + unbilled.id in e.overrides));
  near(owed(e), owed0, "undone: the bill is back"); near(e.spendModel(ym).spend, spend0, "undone: spending is back");
});

ok("refunded after its bill closed: the bill stays, the money comes off the next one", () => {
  const c0 = cardOf(billed), billed0 = c0.billed, owed0 = owed(e), credit0 = credit(e);
  assert.ok(e.revInfo(billed.id).billed);
  assert.strictEqual(e.act.reverse(billed.id), "");
  const on = e.overrides["rev|" + billed.id];
  assert.strictEqual(on, e.iso(e.sod(new Date())), "refunded today");
  assert.ok(e.TX.some((t) => t.id === billed.id), "the charge stays on its bill");
  const back = e.TX.find((t) => t.id === billed.id + "~refund");
  assert.ok(back && back.dir === "in" && Math.abs(back.amt - billed.amt) < 0.01 && back.refundOf === billed.id, "a refund of the same amount today");
  near(cardOf(billed).billed, billed0, "the closed bill doesn't change");
  // what you owe goes down by it; on a bill already paid it's a credit on the card instead
  near(owed0 - owed(e) + credit(e) - credit0, billed.amt, "what you owe goes down by it, or it's a credit");
  const x = e.allTx().find((t) => t.id === billed.id);
  assert.strictEqual(x.refunded, on);
  assert.ok(!e.rewSpends(e.txFor(billed.ym)).some((t) => t.id === billed.id), "a refunded spend earns no points");
  e.act.unreverse(billed.id + "~refund");                    // undo from the refund row works too
  assert.ok(!e.TX.some((t) => t.id === billed.id + "~refund")); near(owed(e), owed0, "undone");
});

ok("only a card payment can be marked, and the mark survives a reload", () => {
  const bank = e.TX.find((t) => t.dir === "out" && !e.CARD_CFG[t.account]);
  assert.ok(e.act.reverse(bank.id) !== "" && e.revInfo(bank.id) === null, "a bank payment can't be");
  e.act.reverse(unbilled.id);
  // the saved copy (settings.app.state.data) with this mark in its overrides, read by a fresh engine
  const st = F.settings.find((r) => r.key === "app.state").value;
  const settings = [{ key: "app.state", value: Object.assign({}, st, { data: Object.assign({}, st.data, { overrides: JSON.parse(JSON.stringify(e.overrides)) }) }) }];
  const f = make(settings);
  assert.strictEqual(f.overrides["rev|" + unbilled.id], true);
  assert.ok(!f.TX.some((t) => t.id === unbilled.id), "applied on load");
  assert.ok(f.allTx().find((x) => x.id === unbilled.id).reversed, "listed as reversed after a reload");
  e.act.unreverse(unbilled.id);
});

console.log("\nall " + n + " passed");
