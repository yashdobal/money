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
  // what Today shows, in words: the hero, how it's worked out, Needs attention, Coming up, EMIs
  const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v), iso = (d) => (d ? e.iso(d) : null);
  const cards = e.allCards(), h = e.heroModel(cards), net = e.netModel(cards);
  const t = (x) => x && [r2(x.total), r2(x.perDay), x.days];
  const screens = {
    hero: h.state !== "ok" ? { state: h.state } : {
      state: h.state, pace: r2(h.pace), line: h.line, tone: h.tone, explain: h.explain,
      rows: h.rows.map((r) => [r.title, r.detail, r2(r.amt), r.tone || "", !!r.total]),
      fixes: h.fixes.map((r) => [r.title, r.detail, r2(r.amt), !!r.upTo]), leftToFind: r2(h.leftToFind),
      nextPay: h.nextPay && [h.nextPay.title, h.nextPay.detail, r2(h.nextPay.amt), iso(h.nextPay.d), h.nextPay.overdue],
      nextBig: h.nextBig && [h.nextBig.title, h.nextBig.detail, r2(h.nextBig.amt), iso(h.nextBig.d), h.nextBig.overdue],
      tiles: [t(h.tiles.rest), t(h.tiles.next), t(h.tiles.usual)],
      chart: [h.chart.pts.map((p) => [iso(p.d), r2(p.bal)]), iso(h.chart.from), iso(h.chart.to), r2(h.chart.buffer), [iso(h.chart.low.d), r2(h.chart.low.bal)], h.chart.paydays.map(iso)],
    },
    attention: e.attention(cards, h, net).map((a) => [a.tone, a.icon, a.title, a.detail, a.amt === null ? null : r2(a.amt)]),
    coming: e.comingUp(cards, h.f).map((g) => [iso(g.d), g.n, g.items.map((i) => [i.dot, i.title, i.detail, i.amt === null || i.amt === undefined ? null : r2(i.amt), !!i.soft, !!i.overdue])]),
    history: (() => { const hh = e.balanceHistory(); return hh && [hh.pts.map((p) => [iso(p.d), r2(p.bal)]), hh.marks.map((m) => [iso(m.d), m.kind, r2(m.amt), m.title]), r2(hh.now), iso(hh.set), hh.missing]; })(),
    emis: e.emiModel().map((x) => [x.name, x.where, x.on, x.tenure, x.done, r2(x.per), x.next ? [x.next.k, r2(x.next.amt), iso(x.next.d)] : null, r2(x.left), r2(x.total), iso(x.last)]),
    // Plan, Cards and the CSV export
    calendar: e.calendarEvents(cards, h.f || null).map((c) => [iso(c.d), c.dot, c.title, c.detail, c.amt === null || c.amt === undefined ? null : r2(c.amt), !!c.soft]),
    goals: e.goalPlan(e.payCycle()).map((p) => [p.g.id, r2(p.g.target), r2(p.saved), r2(p.movedNow), r2(p.need), p.monthsLeft, !!p.done, iso(p.due), r2(p.pct), !!p.byRule,
      p.byEmi ? (p.byEmi.next ? p.byEmi.next.due : null) : null, r2(p.funded), r2(p.short)]),
    cardPays: cards.map((c) => [c.key, e.cardPayments(c).map((p) => [p.ts, r2(p.amt), p.kind, p.how, p.off, p.beforeText])]),
    csv: e.csvText(),
  };
  out.push({ at, snap, screens });
  globalThis.Date = RealDate;
}
process.stdout.write(JSON.stringify(out));
