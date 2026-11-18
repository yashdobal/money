// Rewards (app/rewards.js, through the generated engine): the rulebook hangs together, words are read the way a person
// means them, and the points, caps and values match figures worked out by hand. Run node tools/rn_engine.mjs first.
import fs from "fs";
import path from "path";
import url from "url";
import assert from "assert";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8"));
const rn = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const store = {};
const e = rn.makeEngine({
  window: { MONEY: { serverCall: async () => ({ ok: true }) }, UI: { render() {} } },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { hidden: false, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }) },
});
e.ingest(e.shapeData({
  tx: F.transactions, emails: F.card_emails, pays: F.card_payments,
  goals: F.goals, contribs: F.goal_contributions, rules: F.rules, settings: F.settings,
  edits: e.shapeEdits(F.payee_rules, F.txn_notes), lastSync: F.ingest_log[0] && F.ingest_log[0].received_at,
}));
const D = e.REWARD_DATA, card = (id) => e.rewCardById(id), near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, msg + ": " + a + " ≠ " + b);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };

ok("the rulebook hangs together", () => {
  const srcs = new Set(Object.keys(D.sources)), kinds = new Set(e.REW_KINDS.map((k) => k.id)), shops = new Set(e.REW_SHOPS.map((s) => s.id));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(D.checked));
  e.REW_CARDS.forEach((c) => {
    assert.ok(c.name && c.bank && c.base > 0 && c.fee >= 0 && ["open", "invite", "paused"].includes(c.status), c.id);
    assert.ok(c.cash && c.cash.per > 0 && c.cash.how, c.id + " cash value");
    if (c.trip) assert.ok(e.TRIP_DATA.cards.some((t) => t.id === c.trip), c.id + " trip card");
    (c.src || []).forEach((s) => assert.ok(srcs.has(s), c.id + " names a source that isn't listed: " + s));
    c.no.forEach((k) => assert.ok(kinds.has(k), c.id + " no: " + k));
    (c.bonus || []).forEach((b) => { (b.merchants || []).forEach((m) => assert.ok(shops.has(m), c.id + " bonus shop " + m)); (b.kinds || []).forEach((k) => assert.ok(kinds.has(k), c.id + " bonus kind " + k)); assert.ok(b.rate > c.base, c.id + " " + b.label); });
    (c.routes || []).forEach((r) => { Object.keys(r.kinds || {}).forEach((k) => assert.ok(kinds.has(k), c.id + " route kind " + k)); Object.keys(r.merchants || {}).forEach((m) => assert.ok(shops.has(m), c.id + " route shop " + m)); });
    if (c.unit === "points") assert.ok(c.to && Object.values(c.to).some(Boolean), c.id + " has no transfer partner");
  });
  assert.strictEqual(new Set(e.REW_CARDS.map((c) => c.id)).size, e.REW_CARDS.length, "a card is listed twice");
});

ok("what you type is read the way you mean it", () => {
  const p = (t) => e.rewParse(t);
  let s = p("₹40k flight to Tokyo"); assert.deepStrictEqual([s.amt, s.kind, s.shop, s.intl], [40000, "flights", null, false]);
  s = p("new iPhone 16 for 79,900"); assert.deepStrictEqual([s.amt, s.kind], [79900, "electronics"]);
  s = p("iPhone on Amazon 1.2 lakh"); assert.deepStrictEqual([s.amt, s.kind, s.shop], [120000, "electronics", "amazon"]);
  s = p("Swiggy order"); assert.deepStrictEqual([s.amt, s.kind, s.shop, s.online], [null, "food", "swiggy", true]);
  s = p("Instamart groceries 900"); assert.deepStrictEqual([s.kind, s.shop], ["grocery", "instamart"]);
  s = p("dinner in Dubai 5000"); assert.deepStrictEqual([s.kind, s.intl, s.online], ["dining", true, false]);
  s = p("Goa resort 3 nights 24000"); assert.deepStrictEqual([s.kind, s.amt], ["hotels", 24000]);
  s = p("petrol"); assert.strictEqual(s.kind, "fuel");
  s = p("electricity bill 2500"); assert.deepStrictEqual([s.kind, s.amt], ["utilities", 2500]);
  s = p("$120 on a US website"); assert.strictEqual(s.intl, true);
  s = p("shoes at the mall 3000"); assert.deepStrictEqual([s.kind, s.online], ["fashion", false]);
});

const at = Date.now();
const way = (c, sp, used, route) => e.rewWays(card(c), Object.assign({ shop: null, online: true, intl: false }, sp), used || {}, at).find((w) => w.route === (route || "card"));

ok("Regalia Gold on SmartBuy hotels: 10×, 2,000 extra points a day, worth most through Accor", () => {
  // ₹20,000: 25 per ₹100 = 5,000, of which 4,500 are extra; at most 2,000 extra a day → 500 + 2,000 = 2,500
  const w = way("hdfc-regalia-gold", { amt: 20000, kind: "hotels" }, {}, "smartbuy");
  near(w.pts, 2500, "points"); near(w.worth.cash, 1250, "cash at ₹0.50");
  // Air India 3:1 → 833 × ₹1; KrisFlyer 2:1 → 1,250 × ₹1; Accor 2:1 → 1,250 × €40/2,000 × ₹105 = ₹2,625
  assert.strictEqual(w.worth.partner, "accor"); near(w.worth.miles, 2625, "Accor value");
  assert.ok(w.notes.some((t) => /2,000 extra points a day/.test(t)));
});

ok("SmartBuy vouchers stop at the 3,000-point monthly voucher cap; the base points still come", () => {
  const sbv = { id: "sb-v", per: "month" }, used = {}; used[e.rewKey(sbv, at)] = 2500;
  // a ₹10,000 Swiggy voucher: 12.5 per ₹100 = 1,250, of which 1,000 extra; 500 left under the cap → 250 + 500
  const w = way("hdfc-regalia-gold", { amt: 10000, kind: "food", shop: "swiggy" }, used, "smartbuy-v");
  near(w.pts, 750, "points"); assert.ok(w.capped);
  // straight on the card instead: 2.5 per ₹100
  near(way("hdfc-regalia-gold", { amt: 10000, kind: "food", shop: "swiggy" }).pts, 250, "on the card");
});

ok("Amazon Pay ICICI: 5% on Amazon with Prime, 3% without, 2% at an Amazon Pay partner", () => {
  near(way("icici-amazon-pay", { amt: 80000, kind: "electronics", shop: "amazon" }).pts, 4000, "Prime");
  e.overrides.rew = { prime: false };
  near(way("icici-amazon-pay", { amt: 80000, kind: "electronics", shop: "amazon" }).pts, 2400, "no Prime");
  delete e.overrides.rew;
  near(way("icici-amazon-pay", { amt: 600, kind: "food", shop: "swiggy" }, {}, "amazonpay").pts, 12, "partner");
  near(way("icici-amazon-pay", { amt: 2500, kind: "utilities" }).pts, 0, "a bill paid straight to the company");
});

ok("caps in rupees: SBI Cashback's 5% online stops at ₹2,000 a statement", () => {
  near(way("sbi-cashback", { amt: 50000, kind: "shopping" }).pts, 2000, "online");
  near(way("sbi-cashback", { amt: 50000, kind: "shopping", online: false }).pts, 500, "in a shop: 1%");
});

ok("spending that earns nothing, and a foreign currency with the markup taken off", () => {
  e.REW_CARDS.forEach((c) => near(way(c.id, { amt: 3000, kind: "fuel", online: false }).pts, 0, c.id + " fuel"));
  // AURUM abroad: 4 per ₹100 on ₹10,000 = 400 points, ₹100 as cash; 1.99% markup = ₹199
  const w = way("sbi-aurum", { amt: 10000, kind: "dining", online: false, intl: true });
  near(w.pts, 400, "points"); near(w.fee, 199, "markup"); near(w.net, 100 - 199, "net");
  near(way("hsbc-live-plus", { amt: 10000, kind: "dining", intl: true }).pts, 0, "Live+ abroad");
});

ok("the income bar: only cards open to you, and invitation-only ones never", () => {
  const inc = { amt: 1221600, from: "salary" };
  assert.ok(!e.rewCanGet(card("hdfc-regalia-gold"), inc), "₹18L card on ₹12.2L");
  assert.ok(e.rewCanGet(card("hdfc-millennia"), inc));
  assert.ok(e.rewCanGet(card("sbi-cashback"), inc), "no published bar");
  assert.ok(!e.rewCanGet(card("hdfc-infinia"), { amt: 1e8 }), "invitation only");
  // the demo's gross pay × 12 (Plan → Salary)
  assert.strictEqual(e.rewIncome().amt, Math.round(e.OFFER.gross * 12));
});

ok("the search: your best card first, and only cards you could get that do better", () => {
  const r = e.rewSearch(e.rewParse("new iPhone 80000"));
  assert.strictEqual(r.top.card.id, "icici-amazon-pay"); assert.strictEqual(r.top.best.at, "amazon"); near(r.top.best.net, 4000, "5% on Amazon");
  r.could.forEach((x) => assert.ok(e.rewCanGet(x.card, r.income), x.card.id));
  assert.ok(!r.could.some((x) => x.card.id === "icici-amazon-pay" || x.card.id === "sbi-miles"), "a card you hold isn't offered");
  const none = e.rewSearch(e.rewParse("petrol 3000"));
  assert.ok(!(none.top && none.top.best.net > 0));
});

ok("the tab: this month's points, what was left on the table, the next card, milestones", () => {
  const m = e.rewardsModel();
  const shop = m.month.find((h) => h.card && h.card.id === "icici-amazon-pay");
  // every Amazon payment at 5%, everything else at 1% (none of it is the kinds that earn nothing)
  const list = e.rewSpends(e.txFor(e.ymOf(new Date()))).filter((x) => x.card === shop.g);
  const want = list.reduce((s, x) => { const sp = e.rewTxSpend(x); return s + (card("icici-amazon-pay").no.includes(sp.kind) || (sp.kind === "utilities") ? 0 : x.amt * (sp.shop === "amazon" ? 5 : 1) / 100); }, 0);
  near(shop.pts, want, "Amazon Pay ICICI cashback this month");
  assert.ok(m.missed.could >= m.missed.got - 0.01 && m.missed.gap >= 0);
  m.next.rows.forEach((r) => { assert.ok(e.rewCanGet(r.card, m.income)); near(r.net, r.year - r.fee, r.card.id); });
  for (let i = 1; i < m.next.rows.length; i++) assert.ok(m.next.rows[i - 1].net >= m.next.rows[i].net, "sorted");
  m.goals.forEach((g) => assert.ok(g.target > 0 && g.done >= 0));
});

ok("each card's breakdown adds up, and the missed spends say which card to use", () => {
  const m = e.rewardsModel();
  m.month.filter((h) => h.card).forEach((h) => {
    near(h.items.reduce((s, x) => s + x.pts, 0), h.pts, h.short + ": every spend's points");
    near(h.ways.reduce((s, w) => s + w.pts, 0), h.pts, h.short + ": the ways add up");
    near(h.ways.reduce((s, w) => s + w.amt, 0), h.spent, h.short + ": spent");
    assert.strictEqual(h.items.length, h.n);
    h.items.forEach((x) => assert.ok(x.how && (x.pts > 0 || x.how === "Earns nothing"), x.desc));
  });
  m.missed.tips.forEach((t) => { assert.ok(t.card && t.n > 0 && t.gap >= 1 && t.from.length, t.kindName); });
  assert.ok(m.missed.tips.reduce((s, t) => s + t.gap, 0) <= m.missed.gap + 0.01, "the tips are part of the gap");
  m.next.rows.forEach((r) => assert.ok(r.ptsYear >= 0, r.card.id));
});

ok("cards you asked to drop aren't offered (HSBC); their rules still work", () => {
  ["hsbc-travelone", "hsbc-live-plus"].forEach((id) => assert.ok(!e.rewCanGet(card(id), { amt: 1e8 }), id));
  const m = e.rewardsModel();
  assert.ok(!m.next.rows.some((r) => r.card.bank === "HSBC"), "not in Your next card");
  assert.ok(!e.rewSearch(e.rewParse("flight to Tokyo 40000")).could.some((x) => x.card.bank === "HSBC"), "not in If you had…");
  assert.ok(e.rewWays(card("hsbc-travelone"), { amt: 1000, kind: "flights", shop: null }, {}, Date.now())[0].pts > 0);
});

console.log("\nall " + n + " passed");
