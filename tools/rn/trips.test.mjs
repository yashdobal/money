// Trips on points (app/trips.js, through the generated engine): the maths against figures worked out by hand, on the
// demo rows. Run node tools/rn_engine.mjs first.
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
const D = e.TRIP_DATA, card = (id) => e.tripCardById(id);

// --- the data hangs together
const srcs = new Set(Object.keys(D.sources));
D.cards.forEach((c) => {
  c.src.forEach((s) => assert.ok(srcs.has(s), c.id + " names a source that isn't listed: " + s));
  assert.ok(c.earn.base > 0 && c.fee >= 0 && ["open", "invite", "paused"].includes(c.status), c.id);
  assert.ok(c.to.ai || c.to.kf, c.id + " has no airline");
});
D.countries.forEach((c) => {
  assert.ok(srcs.has(c.hsrc) && c.hotel.length === 3 && c.hotel[0] < c.hotel[1] && c.hotel[1] < c.hotel[2], c.id + " hotel prices");
  assert.ok(c.ai && c.ai.y > 0, c.id + " has no economy price");
});
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(D.checked));

// --- the default plan: Japan, 2 people, 7 nights, economy, a mid-range hotel paid with points
let p = e.tripPlan();
assert.deepStrictEqual([p.country, p.people, p.nights, p.cabin, p.stay, p.hotel, p.air, p.when], ["jp", 2, 7, "y", true, 1, "", ""]);
let n = e.tripNeed(p);
assert.strictEqual(n.cabin, "y");
assert.deepStrictEqual(n.airs.map((a) => a.id), ["ai", "kf"], "fewest points first");
assert.strictEqual(n.preferred, "ai"); assert.strictEqual(n.airline, "ai");
assert.strictEqual(n.flight.total, 30000 * 4, "Air India: 30,000 each way × 2 people × 2");
assert.strictEqual(n.airs[1].total, 42000 * 4);
assert.strictEqual(n.rooms, 1);
assert.strictEqual(n.usual, Math.round((107 * D.fx.usd) / 50) * 50, "mid-range room in rupees");
assert.strictEqual(n.hotelCost, n.usual * 7);
const perPt = (D.accor.eur * D.fx.eur) / D.accor.per;
assert.strictEqual(n.accorPts, Math.ceil(n.hotelCost / perPt / 2000) * 2000, "Accor points in blocks of 2,000");

// --- earning: HSBC TravelOne, ₹50,000 everyday + ₹10,000 flights + ₹5,000 fuel a month
const by = { other: 50000, air: 10000, fuel: 5000 };
let er = e.tripEarn(card("hsbc-travelone"), by);
assert.strictEqual(er.pts, 50000 * 0.02 + 10000 * 0.04, "2 per ₹100, 4 on flights, nothing on fuel");
assert.strictEqual(er.spend, 60000);
// Horizon: 5 per ₹100 only on airline bookings, travel sites at 2
assert.strictEqual(e.tripEarn(card("axis-horizon"), { other: 10000, air: 10000, ota: 10000 }).pts, 200 + 500 + 200);
// Diners Black: groceries stop at 2,000 points a month
assert.strictEqual(Math.round(e.tripEarn(card("hdfc-dcb-metal"), { grocery: 90000 }).pts), 2000);

// --- month by month: 1,400 points a month to 14,000 = 10 months; ₹6L counted spend; one joining fee
let r = e.tripRun(card("hsbc-travelone"), 14000, by, 0, false);
assert.deepStrictEqual([r.months, r.spend, r.fees, r.bonus], [10, 600000, Math.round(4999 * 1.18), 0]);
// 24 months of ₹60,000 = ₹7.2L a year: under the ₹8L waiver, so a second fee is charged at month 12; no milestone
r = e.tripRun(card("hsbc-travelone"), 1400 * 24, by, 0, false);
assert.deepStrictEqual([r.months, r.fees], [24, 2 * Math.round(4999 * 1.18)]);
// ₹1,00,000 a month: 2,000 points a month, +10,000 when the year passes ₹12L (month 12) → 34,000 after 12 months
r = e.tripRun(card("hsbc-travelone"), 34000, { other: 100000 }, 0, false);
assert.deepStrictEqual([r.months, r.bonus, r.fees], [12, 10000, Math.round(4999 * 1.18)]);
// Horizon: the 5,000 welcome miles arrive in month 1; 1,500 more at each renewal
r = e.tripRun(card("axis-horizon"), 6000, { other: 50000 }, 0, false);
assert.deepStrictEqual([r.months, r.bonus], [1, 5000]);
r = e.tripRun(card("axis-horizon"), 5000 + 12 * 1000 + 1500 + 1000, { other: 50000 }, 0, false);
assert.deepStrictEqual([r.months, r.fees], [13, 2 * Math.round(3000 * 1.18)], "no waiver on Horizon");
// a card you already hold: no joining fee, no welcome points, and what you have counts
r = e.tripRun(card("axis-horizon"), 6000, { other: 50000 }, 4000, true);
assert.deepStrictEqual([r.months, r.fees, r.bonus], [2, 0, 0]);
// Diners Black: 10,000 points for each quarter with ₹4L of spending
r = e.tripRun(card("hdfc-dcb-metal"), 1e9, { other: 150000 }, 0, false);
assert.strictEqual(r.months, null, "never reached");
r = e.tripRun(card("hdfc-dcb-metal"), 25000, { other: 150000 }, 0, false);
assert.strictEqual(r.months, 3, "3 × 5,000 + 10,000 for the quarter");
// nothing spent, nothing earned
assert.strictEqual(e.tripRun(card("hsbc-travelone"), 1000, {}, 0, false).months, null);

// --- the pace for a date: 14,000 points in 5 months on TravelOne at the same mix (1,400 per ₹60,000) = ₹1,20,000
const pace = e.tripPace(card("hsbc-travelone"), 14000, by, 0, false, 5);
assert.ok(pace >= 120000 && pace <= 120500, "pace " + pace);
assert.strictEqual(e.tripPace(card("hsbc-travelone"), 14000, by, 0, false, 0), null);

// --- the cards for the airline, best conversion first, whatever the income
e.act.setTrip("spend", 60000); e.act.setTrip("travel", 0); e.act.setTrip("income", 1200000);
let m = e.tripModel();
const find = (id) => m.all.find((x) => x.card.id === id);
const order = () => m.best.map((x) => x.card.id);
assert.strictEqual(m.need.airline, "ai");
// Air India points from ₹100: Magnus 6 ÷ 2.5 = 2.4; Horizon, TravelOne, Times Black 2; Diners Black and Infinia 3.33 ÷ 2;
// Regalia Gold 2.5 ÷ 3; AURUM 4 ÷ 5; Miles 0.5 (the demo holds it as an add-on). Ties go to the lower fee.
// SBI Card Miles Elite and Prime are left off Trips (TRIP_LEFT_OUT); a card you hold stays.
assert.deepStrictEqual(order(), ["axis-magnus", "axis-horizon", "hsbc-travelone", "icici-times-black", "hdfc-dcb-metal", "hdfc-infinia",
  "hdfc-regalia-gold", "sbi-aurum", "sbi-miles"]);
assert.ok(!m.all.some((x) => x.card.id === "sbi-miles-elite" || x.card.id === "sbi-miles-prime"), "SBI Miles Elite and Prime are off Trips");
assert.strictEqual(find("axis-magnus").rate, 2.4); assert.strictEqual(find("sbi-aurum").rate, 0.8);
assert.ok(Math.abs(find("hdfc-regalia-gold").rate - 2.5 / 3) < 1e-9);
for (let i = 1; i < m.best.length; i++) assert.ok(m.best[i - 1].rate >= m.best[i].rate, "ranked by conversion");
let hs = find("hsbc-travelone");
assert.strictEqual(hs.fl.prog, "ai"); assert.strictEqual(hs.fl.pts, 120000);
assert.strictEqual(hs.ht.pts, m.need.accorPts); assert.strictEqual(hs.total, 120000 + m.need.accorPts);
assert.strictEqual(find("hdfc-regalia-gold").fl.pts, 360000, "three Regalia points make one Air India point");
assert.strictEqual(find("sbi-aurum").fl.pts, 600000); assert.strictEqual(find("sbi-aurum").ht, null);
assert.ok(find("sbi-aurum").warn.some((w) => /cash/.test(w)));
// what you can get on ₹12L: open cards whose income bar it clears, in the same order; never the invite-only ones
assert.deepStrictEqual(m.get.map((x) => x.card.id), ["axis-horizon", "hsbc-travelone", "sbi-miles"]);
e.act.setTrip("income", 500000); m = e.tripModel();
assert.deepStrictEqual(m.get.map((x) => x.card.id), ["sbi-miles"]);
assert.strictEqual(order()[0], "axis-magnus", "the ranking doesn't move with the income");
e.act.setTrip("income", 3000000); m = e.tripModel();
assert.ok(m.get.some((x) => x.card.id === "axis-magnus") && m.get.some((x) => x.card.id === "hdfc-dcb-metal") && !m.get.some((x) => x.card.id === "hdfc-infinia"));

// --- the other airline: KrisFlyer costs more points to Japan, and the cards re-rank for it
e.act.setTrip("income", 1200000); e.act.setTrip("air", "kf"); m = e.tripModel();
assert.strictEqual(m.need.airline, "kf"); assert.strictEqual(m.need.preferred, "ai"); assert.strictEqual(m.need.flight.total, 168000);
assert.deepStrictEqual(order().slice(0, 3), ["hdfc-dcb-metal", "hdfc-infinia", "axis-magnus"], "1:1 to KrisFlyer at 3.33 per ₹100 leads");
assert.ok(m.off.some((x) => x.card.id === "sbi-aurum") && m.off.some((x) => x.card.id === "sbi-miles"), "cards with no KrisFlyer drop out");
assert.strictEqual(find("hdfc-regalia-gold").fl.pts, 336000);
e.act.setTrip("country", "th"); assert.strictEqual(e.tripPlan().air, "", "a chosen airline belongs to its route");
e.act.setTrip("country", "jp");

// --- business class: only KrisFlyer has a confirmed price to Japan, so it is the airline
e.act.setTrip("cabin", "j"); m = e.tripModel();
assert.strictEqual(m.need.cabin, "j"); assert.deepStrictEqual(m.need.airs.map((a) => a.id), ["kf"]); assert.strictEqual(m.need.flight.total, 88000 * 4);
assert.strictEqual(find("hsbc-travelone").fl.prog, "kf"); assert.strictEqual(find("sbi-miles").fl, null);
// France has no confirmed business price: flights fall back to economy, and the screen is told
e.act.setTrip("country", "fr"); m = e.tripModel();
assert.strictEqual(m.need.cabin, "y"); assert.strictEqual(m.need.noBusiness, true); assert.strictEqual(m.need.flight.total, 35000 * 4);
// Australia in economy: KrisFlyer (42,000) is preferred over Air India (50,000)
e.act.setTrip("cabin", "y"); e.act.setTrip("country", "au"); m = e.tripModel();
assert.strictEqual(m.need.preferred, "kf"); assert.strictEqual(m.need.airline, "kf");

// --- the hotel: its budget, your own price, or left out
e.act.setTrip("country", "th"); e.act.setTrip("people", 3); e.act.setTrip("nights", 5); e.act.setTrip("hotel", 0); m = e.tripModel();
assert.strictEqual(m.need.usual, Math.round((15 * D.fx.usd) / 50) * 50); assert.strictEqual(m.need.rooms, 2);
e.act.setTrip("night", 4000); m = e.tripModel();
assert.strictEqual(m.need.hotelCost, 4000 * 2 * 5); assert.strictEqual(m.need.typed, true); assert.strictEqual(m.need.flight.total, 12000 * 6);
e.act.setTrip("stay", false); m = e.tripModel();
assert.strictEqual(m.need.accorPts, 0); assert.strictEqual(m.need.hotelCost, 0);
hs = find("hsbc-travelone"); assert.strictEqual(hs.ht, null); assert.strictEqual(hs.total, 72000); assert.ok(!hs.warn.some((w) => /cash/.test(w)));
e.act.setTrip("stay", true);
e.act.setTrip("country", "jp"); assert.strictEqual(e.tripPlan().night, null, "a typed room price doesn't follow you to another country");

// --- a date gives a pace
const d = new Date(), when = e.ymOf(new Date(d.getFullYear(), d.getMonth() + 14, 1));
e.act.setTrip("when", when); m = e.tripModel();
assert.strictEqual(m.avail, 12, "14 months away, less 2 to book");
const h2 = find("hsbc-travelone");
assert.ok(h2.pace !== null && h2.pace > 0);
assert.ok(e.tripRun(h2.card, h2.total, e.tripScaled(h2.card, m.mix.by, h2.pace), 0, false).months <= 12, "the pace reaches it in time");

// --- your cards: the ones the app already tracks show as yours (here an add-on the profile names); so does a card you mark
assert.deepStrictEqual(m.yours.map((x) => x.card.id), ["sbi-miles"]);
e.act.setTripCard("hsbc-travelone", true, 50000); m = e.tripModel();
assert.deepStrictEqual(m.yours.map((x) => x.card.id).sort(), ["hsbc-travelone", "sbi-miles"]);
hs = find("hsbc-travelone"); assert.strictEqual(hs.owned, true); assert.strictEqual(hs.auto, false); assert.strictEqual(hs.left, hs.total - 50000);
assert.strictEqual(hs.run.fees, e.tripRun(hs.card, hs.total, m.mix.by, 50000, false).fees - Math.round(4999 * 1.18), "no joining fee on a card you hold");
e.act.setTripCard("hsbc-travelone", false, 0); assert.deepStrictEqual([e.tripPlan().mine.length, Object.keys(e.tripPlan().pts).length], [0, 0]);
// a plan saved by the first version (one "style", one card) still means the same
e.overrides.trip = { country: "sg", style: 3, card: "axis-horizon", have: 7000 };
p = e.tripPlan();
assert.deepStrictEqual([p.cabin, p.hotel, p.mine, p.pts], ["j", 2, ["axis-horizon"], { "axis-horizon": 7000 }]);
e.act.setTrip("nights", 4);
assert.deepStrictEqual([e.overrides.trip.style, e.overrides.trip.card, e.overrides.trip.cabin, e.overrides.trip.hotel, e.overrides.trip.mine], [undefined, undefined, "j", 2, ["axis-horizon"]]);
// an add-on says who holds the points; the points you type for it count
e.act.resetTrip(); m = e.tripModel();
let rg = find("sbi-miles");
assert.deepStrictEqual([rg.owned, rg.auto, rg.addOn], [true, true, true]); assert.ok(rg.warn.some((w) => /add-on/.test(w)));
e.act.setTripCard("sbi-miles", false, 90000); m = e.tripModel(); rg = find("sbi-miles");
assert.strictEqual(rg.owned, true); assert.strictEqual(rg.have, 90000); assert.strictEqual(rg.left, rg.total - 90000);

// --- your spending by kind: from the demo rows, and nothing personal
e.act.resetTrip(); m = e.tripModel();
assert.ok(m.prof.total >= 0 && ["months", "month", "none"].includes(m.prof.basis));
assert.strictEqual(m.prof.everyday + m.prof.travel + m.prof.noearn, m.prof.total);
assert.strictEqual(e.tripKind({ desc: "IndiGo 6E 204", cat: "Travel" }), "air");
assert.strictEqual(e.tripKind({ desc: "MakeMyTrip", cat: "Travel" }), "ota");
assert.strictEqual(e.tripKind({ desc: "Lemon Tree Hotel Goa", cat: "Travel" }), "ota");
assert.strictEqual(e.tripKind({ desc: "Hotel Saravana Bhavan", cat: "Food & dining" }), "other", "a restaurant called Hotel isn't travel");
assert.strictEqual(e.tripKind({ desc: "HPCL petrol pump", cat: "Other" }), "fuel");
assert.strictEqual(e.tripKind({ desc: "Airtel recharge", cat: "Bills & subscriptions" }), "utilities");
assert.strictEqual(e.tripKind({ desc: "Blinkit", cat: "Groceries" }), "grocery");
assert.strictEqual(e.tripKind({ desc: "Swiggy", cat: "Food & dining" }), "other");
console.log("trips: " + D.cards.length + " cards · " + D.countries.length + " countries · demo spending ₹" + m.prof.total + " a month (" + m.prof.basis + ") · best for " + D.air[m.need.airline].short + ": " + m.best[0].card.name);
