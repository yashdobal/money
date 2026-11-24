// What the screens show, in words and figures, for the Rust checks (snapshot.mjs, actions.mjs): Today, Plan, Cards,
// the CSV export, Trips, Rewards and a few Rewards searches. rust/core/src/engine/models.rs screens() is the other side.
export const SEARCHES = ["a new iPhone for 80k", "dinner at a restaurant ₹2,500", "flights to Japan", "swiggy order 600", "groceries on bigbasket", "hotel in Bangkok 12000",
  "netflix", "shoes in store 3000", "petrol 2000", "USD 120 on amazon.com", "uber", "1.5 lakh laptop on flipkart", "coffee in Singapore",
  "12.5k on non smartbuy hotel", "hotel 8000 booked direct", "flight 20k not on makemytrip", "amazon shopping 5000 without amazon pay", "12.5k hotel on smartbuy"];
export function screensOf(e) {
  // what Today shows, in words: the hero, how it's worked out, Needs attention, Coming up, EMIs
  const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v), iso = (d) => (d ? e.iso(d) : null);
  const cards = e.allCards(), h = e.heroModel(cards), net = e.netModel(cards);
  const t = (x) => x && [r2(x.total), r2(x.perDay), x.days];
  return {
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
    trips: tripsOf(e, r2, iso),
    rewards: rewardsOf(e, r2),
    search: SEARCHES.map((q) => searchOf(e, r2, q)),
  };
}

function tripsOf(e, r2, iso) {
  const tm = e.tripModel(), p = tm.plan, n = tm.need;
  const row = (r) => [r.card.id, r2(r.rate), r.owned, r.auto, r.addOn, r.have, r.fl && [r.fl.prog, r.fl.miles, r.fl.ratio, r.fl.pts, r.fl.oneWay], r.ht && [r.ht.points, r.ht.ratio, r.ht.pts],
    r2(r.total), r2(r.left), r.run && [r.run.months, r.run.spend, r2(r.run.fees), r2(r.run.bonus), r2(r.run.perMonth), r2(r.run.counted)], r.pace, r.far, r.canGet, iso(r.ready), r.warn];
  return {
    plan: [p.country, p.people, p.nights, p.cabin, p.stay, p.hotel, p.air, p.when, p.income, p.spend, p.travel, p.night, p.mine, Object.entries(p.pts)],
    income: [tm.income.amt, tm.income.from],
    need: [n.country.id, n.cabin, n.noBusiness, n.seats, n.rooms, n.airs.map((a) => [a.id, a.oneWay, a.total]), n.preferred, n.airline, n.stay, n.tier, n.usual, n.nightly, n.typed, r2(n.hotelCost), r2(n.perPoint), n.accorPts],
    prof: [Object.entries(tm.prof.by), tm.prof.n, tm.prof.basis, r2(tm.prof.everyday), r2(tm.prof.travel), r2(tm.prof.noearn), r2(tm.prof.total)],
    mix: [Object.entries(tm.mix.by).map(([k, v]) => [k, r2(v)]), r2(tm.mix.everyday), r2(tm.mix.travel), r2(tm.mix.noearn), r2(tm.mix.earning), r2(tm.mix.total)],
    known: tm.known, avail: tm.avail, all: tm.all.map(row), best: tm.best.map((r) => r.card.id), get: tm.get.map((r) => r.card.id), yours: tm.yours.map((r) => r.card.id),
    off: tm.off.map((r) => r.card.id), when: iso(tm.whenDate),
  };
}
const wayOf = (r2) => (w) => [w.route, w.label, w.how, r2(w.rate), r2(w.pts), r2(w.extra), !!w.capped, w.caps.map((c) => c.id), w.notes, !!w.free,
  [r2(w.worth.cash), r2(w.worth.miles), w.worth.partner, r2(w.worth.best)], w.fee === undefined ? null : r2(w.fee), r2(w.net), w.at === undefined ? null : w.at];
function rewardsOf(e, r2) {
  const m = e.rewardsModel(), x = m.missed, nx = m.next;
  return {
    month: m.month.map((h) => [h.g, h.short, h.card ? h.card.id : null, h.addOn, r2(h.pts), r2(h.spent), h.n, Object.entries(h.used).map(([k, v]) => [k, r2(v)]).sort(),
      h.caps.map((c) => [c.id, c.name, c.max, c.per, c.on, r2(c.used)]), h.worth && [r2(h.worth.cash), r2(h.worth.miles), h.worth.partner, r2(h.worth.best)],
      h.items.map((i) => [i.id, i.kind, r2(i.pts), i.capped, i.how, i.why, i.forOther]), h.ways.map((w) => [w.text, w.why, w.n, r2(w.amt), r2(w.pts), w.none]), h.full ? h.full.id : null]),
    missed: [r2(x.got), r2(x.could), r2(x.gap), x.misses.map((y) => [y.x.id, r2(y.real), r2(y.realPts), y.used ? y.used.id : null, r2(y.best), r2(y.bestPts), y.card ? y.card.id : null, y.kind, r2(y.gap)]),
      x.tips.map((t) => [t.card.id, t.short, t.kind, t.kindName, t.n, r2(t.amt), r2(t.gap), r2(t.bestPts), t.from.map((f) => [f.card ? f.card.id : null, f.short, r2(f.pts), r2(f.worth)]), t.list.length]), x.n, x.cards],
    next: [nx.rows.map((r) => [r.card.id, r2(r.year), r.fee, r2(r.net), r2(r.spendYear), r2(r.ptsYear), r.top, r.waived]), nx.basis, nx.n, nx.income.amt, r2(nx.spent)],
    goals: m.goals.map((g) => [g.g, g.card.id, g.what, g.worth, g.per, g.target, r2(g.done), !!g.fee]),
    prefs: [m.prefs.prime, m.prefs.ai, m.prefs.kf],
  };
}
function searchOf(e, r2, q) {
  const sp = e.rewParse(q), r = e.rewSearch(sp), way = wayOf(r2);
  return [[sp.text, sp.amt, sp.kind, sp.shop, sp.online, sp.intl, sp.not], r.sp.amt, r.typedAmt, r.yours.map((y) => [y.g, y.card.id, y.ways.map(way)]),
    r.could.map((c) => [c.card.id, c.ways.slice(0, 4).map(way)]), r.top ? r.top.g : null, r.runner ? r.runner.g : null, r.better ? r.better.card.id : null, r.unknown.map((u) => u.g), r.income.amt];
}
