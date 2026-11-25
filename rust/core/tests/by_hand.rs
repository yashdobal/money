//! The engine against figures worked out by hand, on the demo rows (tools/demo/demo-fixture.json): trips on points,
//! rewards (the rulebook, reading what you type, points, caps, values), a card payment marked reversed or refunded, and
//! spending for someone else. These were the old app's checks (tools/rn/*.test.mjs), kept here when it went.
//! The clock is fixed (4 Dec 2026, a day inside the demo's months) so the answers never drift.

use money_core::engine::rulebook::rulebook;
use money_core::engine::*;
use money_core::{shape, time, Engine};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

mod common;
use common::root;

const AT: i64 = 1796400000000;
fn fixture() -> Value { serde_json::from_str(&std::fs::read_to_string(root().join("tools/demo/demo-fixture.json")).unwrap()).unwrap() }
fn make_with(f: &Value, extra_tx: &[Value], extra_notes: &[Value], settings: Option<Value>) -> Engine {
    let mut rows = shape::rows_from_fixture(f);
    rows.tx.extend(extra_tx.iter().cloned());
    if let Some(s) = settings { rows.settings = s.as_array().unwrap().clone(); }
    let notes: Vec<Value> = f["txn_notes"].as_array().cloned().unwrap_or_default().into_iter().chain(extra_notes.iter().cloned()).collect();
    rows.edits = shape::shape_edits(f["payee_rules"].as_array().map(|a| a.as_slice()).unwrap_or(&[]), &notes);
    let mut e = Engine::new();
    e.clock = Some(AT);
    e.ingest(&shape::shape_data(&rows));
    e.resolve_payments();
    e
}
fn make() -> Engine { make_with(&fixture(), &[], &[], None) }
fn near(a: f64, b: f64, tol: f64, msg: &str) { assert!((a - b).abs() < tol, "{}: {} ≠ {}", msg, a, b); }
fn jround(x: f64) -> f64 { (x + 0.5).floor() }
fn by(v: &[(&str, f64)]) -> ByKind { ByKind(v.iter().map(|(k, a)| (k.to_string(), *a)).collect()) }
fn tc(id: &str) -> &'static money_core::engine::rulebook::TripCard { rulebook().trip_card(id).unwrap() }
fn rc(id: &str) -> &'static money_core::engine::rulebook::RewCard { rulebook().rew_card(id).unwrap() }
fn ids(rows: &[TripRow]) -> Vec<String> { rows.iter().map(|x| x.card.id.clone()).collect() }

/* ---------------- trips on points (tools/rn/trips.test.mjs) ---------------- */
#[test]
fn trips_on_points() {
    let mut e = make();
    let d = rulebook();
    // the data hangs together
    let srcs: HashSet<&String> = d.trip_sources.keys().collect();
    for c in &d.trip_cards {
        for s in &c.src { assert!(srcs.contains(s), "{} names a source that isn't listed: {}", c.id, s); }
        assert!(c.earn.base > 0.0 && c.fee >= 0.0 && ["open", "invite", "paused"].contains(&c.status.as_str()), "{}", c.id);
        assert!(c.to_of("ai").is_some() || c.to_of("kf").is_some(), "{} has no airline", c.id);
    }
    for c in &d.countries {
        assert!(srcs.contains(&c.hsrc) && c.hotel.len() == 3 && c.hotel[0] < c.hotel[1] && c.hotel[1] < c.hotel[2], "{} hotel prices", c.id);
        assert!(c.ai.as_ref().and_then(|a| a.y).unwrap_or(0.0) > 0.0, "{} has no economy price", c.id);
    }
    assert!(regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap().is_match(&d.trips_checked));

    // the default plan: Japan, 2 people, 7 nights, economy, a mid-range hotel paid with points
    let p = e.trip_plan();
    assert_eq!((p.country.as_str(), p.people, p.nights, p.cabin.as_str(), p.stay, p.hotel, p.air.as_str(), p.when.as_str()), ("jp", 2, 7, "y", true, 1, "", ""));
    let n = Engine::trip_need(&p);
    assert_eq!(n.cabin, "y");
    assert_eq!(n.airs.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["ai", "kf"], "fewest points first");
    assert_eq!((n.preferred.as_str(), n.airline.as_str()), ("ai", "ai"));
    assert_eq!(n.flight.total, 30000.0 * 4.0, "Air India: 30,000 each way × 2 people × 2");
    assert_eq!(n.airs[1].total, 42000.0 * 4.0);
    assert_eq!(n.rooms, 1);
    assert_eq!(n.usual, jround(107.0 * d.usd / 50.0) * 50.0, "mid-range room in rupees");
    assert_eq!(n.hotel_cost, n.usual * 7.0);
    let per_pt = d.accor_eur * d.eur / d.accor_per;
    assert_eq!(n.accor_pts, (n.hotel_cost / per_pt / 2000.0).ceil() * 2000.0, "Accor points in blocks of 2,000");

    // earning: HSBC TravelOne, ₹50,000 everyday + ₹10,000 flights + ₹5,000 fuel a month
    let mix = by(&[("other", 50000.0), ("air", 10000.0), ("fuel", 5000.0)]);
    let (pts, spend) = Engine::trip_earn(tc("hsbc-travelone"), &mix);
    assert_eq!(pts, 50000.0 * 0.02 + 10000.0 * 0.04, "2 per ₹100, 4 on flights, nothing on fuel");
    assert_eq!(spend, 60000.0);
    assert_eq!(Engine::trip_earn(tc("axis-horizon"), &by(&[("other", 10000.0), ("air", 10000.0), ("ota", 10000.0)])).0, 200.0 + 500.0 + 200.0, "Horizon");
    assert_eq!(jround(Engine::trip_earn(tc("hdfc-dcb-metal"), &by(&[("grocery", 90000.0)])).0), 2000.0, "Diners Black groceries stop at 2,000 a month");

    // month by month
    let fee = |x: f64| jround(x * 1.18);
    let r = Engine::trip_run(tc("hsbc-travelone"), 14000.0, &mix, 0.0, false);
    assert_eq!((r.months, r.spend, r.fees, r.bonus), (Some(10), 600000.0, fee(4999.0), 0.0));
    let r = Engine::trip_run(tc("hsbc-travelone"), 1400.0 * 24.0, &mix, 0.0, false);
    assert_eq!((r.months, r.fees), (Some(24), 2.0 * fee(4999.0)), "under the ₹8L waiver: a second fee at month 12");
    let r = Engine::trip_run(tc("hsbc-travelone"), 34000.0, &by(&[("other", 100000.0)]), 0.0, false);
    assert_eq!((r.months, r.bonus, r.fees), (Some(12), 10000.0, fee(4999.0)), "+10,000 when the year passes ₹12L");
    let r = Engine::trip_run(tc("axis-horizon"), 6000.0, &by(&[("other", 50000.0)]), 0.0, false);
    assert_eq!((r.months, r.bonus), (Some(1), 5000.0), "Horizon's welcome miles in month 1");
    let r = Engine::trip_run(tc("axis-horizon"), 5000.0 + 12.0 * 1000.0 + 1500.0 + 1000.0, &by(&[("other", 50000.0)]), 0.0, false);
    assert_eq!((r.months, r.fees), (Some(13), 2.0 * fee(3000.0)), "no waiver on Horizon");
    let r = Engine::trip_run(tc("axis-horizon"), 6000.0, &by(&[("other", 50000.0)]), 4000.0, true);
    assert_eq!((r.months, r.fees, r.bonus), (Some(2), 0.0, 0.0), "a card you hold");
    assert_eq!(Engine::trip_run(tc("hdfc-dcb-metal"), 1e9, &by(&[("other", 150000.0)]), 0.0, false).months, None, "never reached");
    assert_eq!(Engine::trip_run(tc("hdfc-dcb-metal"), 25000.0, &by(&[("other", 150000.0)]), 0.0, false).months, Some(3), "3 × 5,000 + 10,000 for the quarter");
    assert_eq!(Engine::trip_run(tc("hsbc-travelone"), 1000.0, &by(&[]), 0.0, false).months, None, "nothing spent");

    // the pace for a date
    let pace = Engine::trip_pace(tc("hsbc-travelone"), 14000.0, &mix, 0.0, false, 5).unwrap();
    assert!((120000.0..=120500.0).contains(&pace), "pace {}", pace);
    assert_eq!(Engine::trip_pace(tc("hsbc-travelone"), 14000.0, &mix, 0.0, false, 0), None);

    // the cards for the airline, best conversion first, whatever the income
    e.set_trip("spend", json!(60000)); e.set_trip("travel", json!(0)); e.set_trip("income", json!(1200000));
    let mut m = e.trip_model();
    let find = |m: &TripModel, id: &str| m.all.iter().find(|x| x.card.id == id).cloned().unwrap();
    assert_eq!(m.need.airline, "ai");
    assert_eq!(ids(&m.best), ["axis-magnus", "axis-horizon", "hsbc-travelone", "icici-times-black", "hdfc-dcb-metal", "hdfc-infinia", "hdfc-regalia-gold", "sbi-aurum", "sbi-miles"]);
    assert!(!m.all.iter().any(|x| x.card.id == "sbi-miles-elite" || x.card.id == "sbi-miles-prime"), "SBI Miles Elite and Prime are off Trips");
    assert_eq!(find(&m, "axis-magnus").rate, 2.4); assert_eq!(find(&m, "sbi-aurum").rate, 0.8);
    assert!((find(&m, "hdfc-regalia-gold").rate - 2.5 / 3.0).abs() < 1e-9);
    for w in m.best.windows(2) { assert!(w[0].rate >= w[1].rate, "ranked by conversion"); }
    let hs = find(&m, "hsbc-travelone");
    let fl = hs.fl.clone().unwrap();
    assert_eq!((fl.prog.as_str(), fl.pts), ("ai", 120000.0));
    assert_eq!(hs.ht.as_ref().unwrap().pts, m.need.accor_pts); assert_eq!(hs.total, 120000.0 + m.need.accor_pts);
    assert_eq!(find(&m, "hdfc-regalia-gold").fl.unwrap().pts, 360000.0, "three Regalia points make one Air India point");
    let au = find(&m, "sbi-aurum");
    assert_eq!(au.fl.as_ref().unwrap().pts, 600000.0); assert!(au.ht.is_none()); assert!(au.warn.iter().any(|w| w.contains("cash")));
    assert_eq!(ids(&m.get), ["axis-horizon", "hsbc-travelone", "sbi-miles"], "what you can get on ₹12L");
    e.set_trip("income", json!(500000)); m = e.trip_model();
    assert_eq!(ids(&m.get), ["sbi-miles"]);
    assert_eq!(ids(&m.best)[0], "axis-magnus", "the ranking doesn't move with the income");
    e.set_trip("income", json!(3000000)); m = e.trip_model();
    let g = ids(&m.get);
    assert!(g.contains(&"axis-magnus".to_string()) && g.contains(&"hdfc-dcb-metal".to_string()) && !g.contains(&"hdfc-infinia".to_string()));

    // the other airline
    e.set_trip("income", json!(1200000)); e.set_trip("air", json!("kf")); m = e.trip_model();
    assert_eq!((m.need.airline.as_str(), m.need.preferred.as_str(), m.need.flight.total), ("kf", "ai", 168000.0));
    assert_eq!(ids(&m.best)[..3], ["hdfc-dcb-metal", "hdfc-infinia", "axis-magnus"], "1:1 to KrisFlyer at 3.33 per ₹100 leads");
    assert!(m.off.iter().any(|x| x.card.id == "sbi-aurum") && m.off.iter().any(|x| x.card.id == "sbi-miles"), "cards with no KrisFlyer drop out");
    assert_eq!(find(&m, "hdfc-regalia-gold").fl.unwrap().pts, 336000.0);
    e.set_trip("country", json!("th")); assert_eq!(e.trip_plan().air, "", "a chosen airline belongs to its route");
    e.set_trip("country", json!("jp"));

    // business class
    e.set_trip("cabin", json!("j")); m = e.trip_model();
    assert_eq!(m.need.cabin, "j"); assert_eq!(m.need.airs.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["kf"]); assert_eq!(m.need.flight.total, 88000.0 * 4.0);
    assert_eq!(find(&m, "hsbc-travelone").fl.unwrap().prog, "kf"); assert!(find(&m, "sbi-miles").fl.is_none());
    e.set_trip("country", json!("fr")); m = e.trip_model();
    assert_eq!((m.need.cabin.as_str(), m.need.no_business, m.need.flight.total), ("y", true, 35000.0 * 4.0), "France: no business price");
    e.set_trip("cabin", json!("y")); e.set_trip("country", json!("au")); m = e.trip_model();
    assert_eq!((m.need.preferred.as_str(), m.need.airline.as_str()), ("kf", "kf"), "Australia: KrisFlyer preferred");

    // the hotel: its budget, your own price, or left out
    e.set_trip("country", json!("th")); e.set_trip("people", json!(3)); e.set_trip("nights", json!(5)); e.set_trip("hotel", json!(0)); m = e.trip_model();
    assert_eq!(m.need.usual, jround(15.0 * d.usd / 50.0) * 50.0); assert_eq!(m.need.rooms, 2);
    e.set_trip("night", json!(4000)); m = e.trip_model();
    assert_eq!((m.need.hotel_cost, m.need.typed, m.need.flight.total), (4000.0 * 2.0 * 5.0, true, 12000.0 * 6.0));
    e.set_trip("stay", json!(false)); m = e.trip_model();
    assert_eq!((m.need.accor_pts, m.need.hotel_cost), (0.0, 0.0));
    let hs = find(&m, "hsbc-travelone");
    assert!(hs.ht.is_none()); assert_eq!(hs.total, 72000.0); assert!(!hs.warn.iter().any(|w| w.contains("cash")));
    e.set_trip("stay", json!(true));
    e.set_trip("country", json!("jp")); assert_eq!(e.trip_plan().night, None, "a typed room price doesn't follow you to another country");

    // a date gives a pace: 14 months away, less 2 to book
    let pp = time::parts(e.now());
    let when = time::ym_of(time::local(pp.y, pp.m + 14, 1));
    e.set_trip("when", json!(when)); m = e.trip_model();
    assert_eq!(m.avail, Some(12));
    let h2 = find(&m, "hsbc-travelone");
    let pace = h2.pace.unwrap();
    assert!(pace > 0.0);
    assert!(Engine::trip_run(&h2.card, h2.total, &Engine::trip_scaled(&h2.card, &m.mix.by, pace), 0.0, false).months.unwrap() <= 12, "the pace reaches it in time");

    // your cards
    assert_eq!(ids(&m.yours), ["sbi-miles"]);
    e.set_trip_card("hsbc-travelone", true, 50000.0); m = e.trip_model();
    let mut y = ids(&m.yours); y.sort();
    assert_eq!(y, ["hsbc-travelone", "sbi-miles"]);
    let hs = find(&m, "hsbc-travelone");
    assert_eq!((hs.owned, hs.auto, hs.left), (true, false, hs.total - 50000.0));
    assert_eq!(hs.run.as_ref().unwrap().fees, Engine::trip_run(&hs.card, hs.total, &m.mix.by, 50000.0, false).fees - fee(4999.0), "no joining fee on a card you hold");
    e.set_trip_card("hsbc-travelone", false, 0.0);
    assert_eq!((e.trip_plan().mine.len(), e.trip_plan().pts.len()), (0, 0));
    // a plan saved by the first version (one "style", one card) still means the same
    e.overrides.insert("trip".into(), json!({ "country": "sg", "style": 3, "card": "axis-horizon", "have": 7000 }));
    let p = e.trip_plan();
    assert_eq!((p.cabin.as_str(), p.hotel, p.mine.clone(), p.pts.clone()), ("j", 2, vec!["axis-horizon".to_string()], vec![("axis-horizon".to_string(), 7000.0)]));
    e.set_trip("nights", json!(4));
    let t = e.overrides["trip"].clone();
    assert_eq!((t.get("style"), t.get("card"), &t["cabin"], &t["hotel"], &t["mine"]), (None, None, &json!("j"), &json!(2), &json!(["axis-horizon"])));
    // an add-on says who holds the points; the points you type for it count
    e.reset_trip(); m = e.trip_model();
    let rg = find(&m, "sbi-miles");
    assert_eq!((rg.owned, rg.auto, rg.add_on), (true, true, true)); assert!(rg.warn.iter().any(|w| w.contains("add-on")));
    e.set_trip_card("sbi-miles", false, 90000.0); m = e.trip_model();
    let rg = find(&m, "sbi-miles");
    assert_eq!((rg.owned, rg.have, rg.left), (true, 90000.0, rg.total - 90000.0));

    // your spending by kind
    e.reset_trip(); m = e.trip_model();
    assert!(m.prof.total >= 0.0 && ["months", "month", "none"].contains(&m.prof.basis.as_str()));
    assert_eq!(m.prof.everyday + m.prof.travel + m.prof.noearn, m.prof.total);
    for (desc, cat, kind) in [("IndiGo 6E 204", "Travel", "air"), ("MakeMyTrip", "Travel", "ota"), ("Lemon Tree Hotel Goa", "Travel", "ota"),
        ("Hotel Saravana Bhavan", "Food & dining", "other"), ("HPCL petrol pump", "Other", "fuel"), ("Airtel recharge", "Bills & subscriptions", "utilities"),
        ("Blinkit", "Groceries", "grocery"), ("Swiggy", "Food & dining", "other")] {
        assert_eq!(Engine::trip_kind(desc, cat), kind, "{}", desc);
    }
}

/* ---------------- rewards (tools/rn/rewards.test.mjs) ---------------- */
fn sp(amt: f64, kind: &str, shop: Option<&str>, online: bool, intl: bool) -> Spend {
    Spend { amt: Some(amt), kind: kind.into(), shop: shop.map(String::from), online, intl, ..Default::default() }
}
fn way(e: &Engine, c: &str, s: &Spend, used: &HashMap<String, f64>, route: &str) -> Way {
    e.rew_ways(rc(c), s, used, e.now()).into_iter().find(|w| w.route == route).unwrap_or_else(|| panic!("{} has no {} way", c, route))
}

#[test]
fn rewards() {
    let mut e = make();
    let d = rulebook();
    let none = HashMap::new();
    // the rulebook hangs together
    let srcs: HashSet<&String> = d.rew_sources.keys().collect();
    let kinds: HashSet<&str> = d.kinds.iter().map(|k| k.id.as_str()).collect();
    let shops: HashSet<&str> = d.shops.iter().map(|s| s.id.as_str()).collect();
    assert!(regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap().is_match(&d.rew_checked));
    for c in &d.rew_cards {
        assert!(c.name.is_some() && c.bank.is_some() && c.base > 0.0 && c.fee0() >= 0.0 && ["open", "invite", "paused"].contains(&c.status.as_str()), "{}", c.id);
        assert!(c.cash.as_ref().map(|x| x.per > 0.0 && !x.how.is_empty()).unwrap_or(false), "{} cash value", c.id);
        if let Some(t) = &c.trip { assert!(d.trip_card(t).is_some(), "{} trip card", c.id); }
        let _ = &srcs;
        for k in &c.no { assert!(kinds.contains(k.as_str()), "{} no: {}", c.id, k); }
        for b in &c.bonus {
            for m in b.merchants.iter().flatten() { assert!(shops.contains(m.as_str()), "{} bonus shop {}", c.id, m); }
            for k in b.kinds.iter().flatten() { assert!(kinds.contains(k.as_str()), "{} bonus kind {}", c.id, k); }
            assert!(b.rate > c.base, "{} {}", c.id, b.label);
        }
        for r in &c.routes {
            for k in r.kinds.iter().flat_map(|m| m.keys()) { assert!(kinds.contains(k.as_str()), "{} route kind {}", c.id, k); }
            for m in r.merchants.iter().flat_map(|m| m.keys()) { assert!(shops.contains(m.as_str()), "{} route shop {}", c.id, m); }
        }
        if c.unit == "points" { assert!(c.to.as_ref().map(|t| t.values().any(|v| v.as_f64().unwrap_or(0.0) != 0.0)).unwrap_or(false), "{} has no transfer partner", c.id); }
    }
    assert_eq!(d.rew_cards.iter().map(|c| &c.id).collect::<HashSet<_>>().len(), d.rew_cards.len(), "a card is listed twice");

    // what you type is read the way you mean it
    let s = rew_parse("₹40k flight to Tokyo"); assert_eq!((s.amt, s.kind.as_str(), s.shop.clone(), s.intl), (Some(40000.0), "flights", None, false));
    let s = rew_parse("new iPhone 16 for 79,900"); assert_eq!((s.amt, s.kind.as_str()), (Some(79900.0), "electronics"));
    let s = rew_parse("iPhone on Amazon 1.2 lakh"); assert_eq!((s.amt, s.kind.as_str(), s.shop.as_deref()), (Some(120000.0), "electronics", Some("amazon")));
    let s = rew_parse("Swiggy order"); assert_eq!((s.amt, s.kind.as_str(), s.shop.as_deref(), s.online), (None, "food", Some("swiggy"), true));
    let s = rew_parse("Instamart groceries 900"); assert_eq!((s.kind.as_str(), s.shop.as_deref()), ("grocery", Some("instamart")));
    let s = rew_parse("dinner in Dubai 5000"); assert_eq!((s.kind.as_str(), s.intl, s.online), ("dining", true, false));
    let s = rew_parse("Goa resort 3 nights 24000"); assert_eq!((s.kind.as_str(), s.amt), ("hotels", Some(24000.0)));
    assert_eq!(rew_parse("petrol").kind, "fuel");
    let s = rew_parse("electricity bill 2500"); assert_eq!((s.kind.as_str(), s.amt), ("utilities", Some(2500.0)));
    assert!(rew_parse("$120 on a US website").intl);
    let s = rew_parse("shoes at the mall 3000"); assert_eq!((s.kind.as_str(), s.online), ("fashion", false));

    // Regalia Gold on SmartBuy hotels: 10×, 2,000 extra points a day, worth most through Accor
    let w = way(&e, "hdfc-regalia-gold", &sp(20000.0, "hotels", None, true, false), &none, "smartbuy");
    near(w.pts, 2500.0, 0.01, "points"); near(w.worth.cash, 1250.0, 0.01, "cash at ₹0.50");
    assert_eq!(w.worth.partner.as_deref(), Some("accor")); near(w.worth.miles, 2625.0, 0.01, "Accor value");
    assert!(w.notes.iter().any(|t| t.contains("2,000 extra points a day")));

    // SmartBuy vouchers stop at the 3,000-point monthly cap; the base points still come
    let mut used = HashMap::new();
    used.insert(rew_key(&money_core::engine::rulebook::Cap { id: "sb-v".into(), max: 0.0, per: "month".into(), on: String::new() }, e.now()), 2500.0);
    let w = way(&e, "hdfc-regalia-gold", &sp(10000.0, "food", Some("swiggy"), true, false), &used, "smartbuy-v");
    near(w.pts, 750.0, 0.01, "points"); assert!(w.capped);
    near(way(&e, "hdfc-regalia-gold", &sp(10000.0, "food", Some("swiggy"), true, false), &none, "card").pts, 250.0, 0.01, "on the card");

    // Amazon Pay ICICI: 5% on Amazon with Prime, 3% without, 2% at an Amazon Pay partner
    near(way(&e, "icici-amazon-pay", &sp(80000.0, "electronics", Some("amazon"), true, false), &none, "card").pts, 4000.0, 0.01, "Prime");
    e.overrides.insert("rew".into(), json!({ "prime": false }));
    near(way(&e, "icici-amazon-pay", &sp(80000.0, "electronics", Some("amazon"), true, false), &none, "card").pts, 2400.0, 0.01, "no Prime");
    e.overrides.remove("rew");
    near(way(&e, "icici-amazon-pay", &sp(600.0, "food", Some("swiggy"), true, false), &none, "amazonpay").pts, 12.0, 0.01, "partner");
    near(way(&e, "icici-amazon-pay", &sp(2500.0, "utilities", None, true, false), &none, "card").pts, 0.0, 0.01, "a bill paid straight to the company");

    // caps in rupees: SBI Cashback's 5% online stops at ₹2,000 a statement
    near(way(&e, "sbi-cashback", &sp(50000.0, "shopping", None, true, false), &none, "card").pts, 2000.0, 0.01, "online");
    near(way(&e, "sbi-cashback", &sp(50000.0, "shopping", None, false, false), &none, "card").pts, 500.0, 0.01, "in a shop: 1%");

    // spending that earns nothing, and a foreign currency with the markup taken off
    for c in &d.rew_cards { near(way(&e, &c.id, &sp(3000.0, "fuel", None, false, false), &none, "card").pts, 0.0, 0.01, &format!("{} fuel", c.id)); }
    let w = way(&e, "sbi-aurum", &sp(10000.0, "dining", None, false, true), &none, "card");
    near(w.pts, 400.0, 0.01, "points"); near(w.fee.unwrap_or(0.0), 199.0, 0.01, "markup"); near(w.net, 100.0 - 199.0, 0.01, "net");
    near(way(&e, "hsbc-live-plus", &sp(10000.0, "dining", None, true, true), &none, "card").pts, 0.0, 0.01, "Live+ abroad");

    // the income bar: only cards open to you, and invitation-only ones never
    let inc = Income { amt: Some(1221600.0), from: Some("salary".into()) };
    assert!(!rew_can_get(rc("hdfc-regalia-gold"), &inc), "₹18L card on ₹12.2L");
    assert!(rew_can_get(rc("hdfc-millennia"), &inc));
    assert!(rew_can_get(rc("sbi-cashback"), &inc), "no published bar");
    assert!(!rew_can_get(rc("hdfc-infinia"), &Income { amt: Some(1e8), from: None }), "invitation only");
    assert_eq!(e.rew_income().amt, Some(jround(e.offer.gross * 12.0)), "the demo's gross pay × 12");

    // the search: your best card first, and only cards you could get that do better
    let r = e.rew_search(&rew_parse("new iPhone 80000"));
    let top = r.top.clone().unwrap();
    assert_eq!(top.card.id, "icici-amazon-pay"); assert_eq!(top.best.as_ref().unwrap().at.as_deref(), Some("amazon")); near(top.best.as_ref().unwrap().net, 4000.0, 0.01, "5% on Amazon");
    for x in &r.could { assert!(rew_can_get(x.card, &r.income), "{}", x.card.id); }
    assert!(!r.could.iter().any(|x| x.card.id == "icici-amazon-pay" || x.card.id == "sbi-miles"), "a card you hold isn't offered");
    let n = e.rew_search(&rew_parse("petrol 3000"));
    assert!(!n.top.and_then(|t| t.best).map(|b| b.net > 0.0).unwrap_or(false));

    // the tab: this month's points, what was left on the table, the next card, milestones
    let m = e.rewards_model();
    let shop = m.month.iter().find(|h| h.card.map(|c| c.id == "icici-amazon-pay").unwrap_or(false)).unwrap();
    let list: Vec<Row> = rew_spends(e.tx_for(Some(&time::ym_of(e.now())), false)).into_iter().filter(|x| x.card.as_deref() == Some(shop.g.as_str())).collect();
    let ap = rc("icici-amazon-pay");
    let want: f64 = list.iter().map(|x| { let s = Engine::rew_tx_spend(x); if ap.no.contains(&s.kind) || s.kind == "utilities" { 0.0 } else { x.t.amt * if s.shop.as_deref() == Some("amazon") { 5.0 } else { 1.0 } / 100.0 } }).sum();
    near(shop.pts, want, 0.01, "Amazon Pay ICICI cashback this month");
    assert!(m.missed.could >= m.missed.got - 0.01 && m.missed.gap >= 0.0);
    for r in &m.next.rows { assert!(rew_can_get(r.card, &m.income)); near(r.net, r.year - r.fee, 0.01, &r.card.id); }
    for w in m.next.rows.windows(2) { assert!(w[0].net >= w[1].net, "sorted"); }
    for g in &m.goals { assert!(g.target > 0.0 && g.done >= 0.0); }

    // each card's breakdown adds up, and the missed spends say which card to use
    for h in m.month.iter().filter(|h| h.card.is_some()) {
        near(h.items.iter().map(|x| x.pts).sum(), h.pts, 0.01, &format!("{}: every spend's points", h.short));
        near(h.ways.iter().map(|w| w.pts).sum(), h.pts, 0.01, &format!("{}: the ways add up", h.short));
        near(h.ways.iter().map(|w| w.amt).sum(), h.spent, 0.01, &format!("{}: spent", h.short));
        assert_eq!(h.items.len(), h.n);
        for x in &h.items { assert!(!x.how.is_empty() && (x.pts > 0.0 || x.how == "Earns nothing"), "{}", x.desc); }
    }
    for t in &m.missed.tips { assert!(t.n > 0 && t.gap >= 1.0 && !t.from.is_empty(), "{}", t.kind_name); }
    assert!(m.missed.tips.iter().map(|t| t.gap).sum::<f64>() <= m.missed.gap + 0.01, "the tips are part of the gap");
    for r in &m.next.rows { assert!(r.pts_year >= 0.0, "{}", r.card.id); }

    // cards you asked to drop aren't offered (HSBC); their rules still work
    for id in ["hsbc-travelone", "hsbc-live-plus"] { assert!(!rew_can_get(rc(id), &Income { amt: Some(1e8), from: None }), "{}", id); }
    assert!(!m.next.rows.iter().any(|r| r.card.bank.as_deref() == Some("HSBC")), "not in Your next card");
    assert!(!e.rew_search(&rew_parse("flight to Tokyo 40000")).could.iter().any(|x| x.card.bank.as_deref() == Some("HSBC")), "not in If you had…");
    assert!(e.rew_ways(rc("hsbc-travelone"), &Spend { amt: Some(1000.0), kind: "flights".into(), ..Default::default() }, &none, e.now())[0].pts > 0.0);

    // what you rule out stays out: "non SmartBuy", "not on MakeMyTrip", "booked direct"
    let p = rew_parse("12.5k on non smartbuy hotel");
    assert_eq!((p.kind.as_str(), p.shop.clone(), p.amt, p.not.clone()), ("hotels", None, Some(12500.0), vec!["smartbuy".to_string()]));
    let rg = rc("hdfc-regalia-gold");
    assert!(e.rew_ways(rg, &rew_parse("12.5k hotel"), &none, e.now()).iter().any(|w| w.route == "smartbuy"), "no channel named: SmartBuy is still a way");
    assert!(!e.rew_ways(rg, &p, &none, e.now()).iter().any(|w| w.route.starts_with("smartbuy")), "non SmartBuy: no SmartBuy way");
    assert_eq!(rew_parse("12.5k hotel on smartbuy").shop.as_deref(), Some("smartbuy"));
    assert_eq!(rew_parse("flight 20k not on makemytrip").not, ["makemytrip"]);
    assert!(!e.rew_search(&rew_parse("flight 20k not on makemytrip")).yours.iter().any(|y| y.ways.iter().any(|w| w.at.as_deref() == Some("makemytrip"))), "MakeMyTrip isn't offered");
    let dn = rew_parse("hotel 8000 booked direct").not;
    for id in ["smartbuy", "traveledge", "hsbcapp", "makemytrip", "cleartrip", "goibibo"] { assert!(dn.iter().any(|x| x == id), "{}", id); }
    assert_eq!(rew_parse("not swiggy, zomato 500").shop.as_deref(), Some("zomato"));
}

/* ---------------- a card payment reversed or refunded (tools/rn/reverse.test.mjs) ---------------- */
fn owed(e: &Engine) -> f64 { e.all_cards().iter().map(|c| c.owed).sum() }
fn credit(e: &Engine) -> f64 { e.all_cards().iter().map(|c| c.credit).sum() }
fn card_of(e: &Engine, account: &str) -> Option<CardState> { e.all_cards().into_iter().find(|c| c.members.iter().any(|m| m == account)) }

#[test]
fn reversed_or_refunded() {
    let f = fixture();
    let mut e = make_with(&f, &[], &[], None);
    let spends: Vec<money_core::shape::Tx> = e.tx.iter().filter(|t| t.dir == "out" && e.card_cfg.contains_key(&t.account)
        && e.tx_for(Some(&t.ym), false).iter().find(|x| x.t.id == t.id).map(|x| x.t.counted).unwrap_or(false)).cloned().collect();
    let pick = |want_billed: bool| -> Option<money_core::shape::Tx> {
        let mut v: Vec<_> = spends.iter().filter(|t| card_of(&e, &t.account).map(|c| !c.pre_first && if want_billed {
            t.ts <= c.c.stmt && t.ts > c.c.prev_stmt + time::DAY } else { t.ts > c.c.stmt + time::DAY - 1 }).unwrap_or(false)).cloned().collect();
        v.sort_by(|a, b| b.amt.partial_cmp(&a.amt).unwrap());
        v.into_iter().next()
    };
    let (unbilled, billed) = (pick(false).expect("an unbilled card spend"), pick(true).expect("a billed card spend"));

    // reversed before its bill: off the bill, spending and points, still listed so it can be undone
    let (owed0, spend0) = (owed(&e), e.spend_model(&unbilled.ym).spend);
    let info = e.rev_info(&unbilled.id).unwrap();
    assert!(!info.billed && !info.gone && info.on.is_none());
    assert_eq!(e.reverse(&unbilled.id), "");
    assert_eq!(e.overrides.get(&format!("rev|{}", unbilled.id)), Some(&json!(true)));
    assert!(!e.tx.iter().any(|t| t.id == unbilled.id), "gone from the figures");
    near(owed0 - owed(&e), unbilled.amt, 0.5, "the card owes less by it");
    near(spend0 - e.spend_model(&unbilled.ym).spend, unbilled.amt, 0.5, "spending less by it");
    let row = e.all_tx().into_iter().find(|x| x.t.id == unbilled.id).unwrap();
    assert!(row.reversed && !row.t.counted, "still in Activity, marked reversed");
    assert!(!e.rew_month().iter().any(|h| h.items.iter().any(|x| x.id == unbilled.id)), "no points on it");
    e.unreverse(&unbilled.id);
    assert!(!e.overrides.contains_key(&format!("rev|{}", unbilled.id)));
    near(owed(&e), owed0, 0.5, "undone: the bill is back"); near(e.spend_model(&unbilled.ym).spend, spend0, 0.5, "undone: spending is back");

    // refunded after its bill closed: the bill stays, the money comes off the next one
    let (billed0, owed0, credit0) = (card_of(&e, &billed.account).unwrap().billed, owed(&e), credit(&e));
    assert!(e.rev_info(&billed.id).unwrap().billed);
    assert_eq!(e.reverse(&billed.id), "");
    let on = e.overrides[&format!("rev|{}", billed.id)].clone();
    assert_eq!(on, json!(time::iso(e.today())), "refunded today");
    assert!(e.tx.iter().any(|t| t.id == billed.id), "the charge stays on its bill");
    let back = e.tx.iter().find(|t| t.id == format!("{}~refund", billed.id)).cloned().unwrap();
    assert!(back.dir == "in" && (back.amt - billed.amt).abs() < 0.01 && back.refund_of.as_deref() == Some(billed.id.as_str()), "a refund of the same amount today");
    near(card_of(&e, &billed.account).unwrap().billed, billed0, 0.5, "the closed bill doesn't change");
    near(owed0 - owed(&e) + credit(&e) - credit0, billed.amt, 0.5, "what you owe goes down by it, or it's a credit");
    assert_eq!(e.all_tx().into_iter().find(|t| t.t.id == billed.id).unwrap().refunded, on.as_str().map(String::from));
    assert!(!rew_spends(e.tx_for(Some(&billed.ym), false)).iter().any(|t| t.t.id == billed.id), "a refunded spend earns no points");
    e.unreverse(&format!("{}~refund", billed.id));                     // undo from the refund row works too
    assert!(!e.tx.iter().any(|t| t.id == format!("{}~refund", billed.id))); near(owed(&e), owed0, 0.5, "undone");

    // only a card payment can be marked, and the mark survives a reload
    let bank = e.tx.iter().find(|t| t.dir == "out" && !e.card_cfg.contains_key(&t.account)).cloned().unwrap();
    assert!(!e.reverse(&bank.id).is_empty() && e.rev_info(&bank.id).is_none(), "a bank payment can't be");
    e.reverse(&unbilled.id);
    let settings: Vec<Value> = f["settings"].as_array().unwrap().iter().map(|r| {
        if r["key"] != "app.state" { return r.clone(); }
        let mut r = r.clone();
        r["value"]["data"]["overrides"] = Value::Object(e.overrides.clone());
        r
    }).collect();
    let g = make_with(&f, &[], &[], Some(Value::Array(settings)));
    assert_eq!(g.overrides.get(&format!("rev|{}", unbilled.id)), Some(&json!(true)));
    assert!(!g.tx.iter().any(|t| t.id == unbilled.id), "applied on load");
    assert!(g.all_tx().into_iter().find(|x| x.t.id == unbilled.id).unwrap().reversed, "listed as reversed after a reload");
}

/* ---------------- spent for someone else (tools/rn/others.test.mjs) ---------------- */
#[test]
fn spent_for_someone_else() {
    let f = fixture();
    let base = make_with(&f, &[], &[], None);
    let cards = base.all_cards();
    let mut open: Vec<money_core::shape::Tx> = base.tx.iter().filter(|t| t.dir == "out" && base.card_cfg.contains_key(&t.account)).filter(|t| {
        cards.iter().find(|c| c.members.contains(&t.account)).map(|c| !c.pre_first && t.ts > c.c.stmt + time::DAY).unwrap_or(false)
    }).cloned().collect();
    open.sort_by(|a, b| b.amt.partial_cmp(&a.amt).unwrap());
    let open = open.into_iter().next().expect("an unbilled card spend");
    let note = json!({ "txn_ref": open.id, "category": null, "for_someone_else": true, "paid_back": false, "note": "" });
    let other = make_with(&f, &[], &[note.clone()], None);
    let sum_owed = |e: &Engine| e.all_cards().iter().map(|c| c.owed).sum::<f64>();

    // the card still owes it, but it's expected back
    let (c0, c1) = (base.all_cards(), other.all_cards());
    near(sum_owed(&other), sum_owed(&base), 0.5, "the bank still bills it");
    near(other.owed_back(&c1).total - base.owed_back(&c0).total, open.amt, 0.5, "back from others");

    // where you stand and the forecast go up by it
    near(other.net_model(&c1).unwrap().now - base.net_model(&c0).unwrap().now, open.amt, 0.5, "where you stand");
    let (f0, f1) = (base.forecast(&c0).unwrap(), other.forecast(&c1).unwrap());
    near(f1.segs[f1.end].bal - f0.segs[f0.end].bal, open.amt, 0.5, "balance at the end of the window");
    let h = other.hero_model(&c1);
    assert!(h.rows.iter().any(|r| r.title == "Back from others" && (r.amt - open.amt).abs() < 0.5), "a row in how it's worked out");

    // a bill paid from a salary takes only your part
    let mut cyc = base.pay_cycle();
    for _ in 0..3 {
        let (a, b) = (base.month_plan(&cyc), other.month_plan(&cyc));
        let back = b.cards.iter().map(|c| c.back).sum::<f64>() - a.cards.iter().map(|c| c.back).sum::<f64>();
        near(a.cards_total - b.cards_total, back, 0.5, "cards total less what comes back");
        near(b.spend - a.spend, back, 0.5, "spending share");
        cyc = base.next_cycle(&cyc);
    }

    // money paid back settles it, and doesn't come off your spending as well
    let bank = f["transactions"].as_array().unwrap().iter().find(|t| t["accounts"]["kind"] == "bank").unwrap().clone();
    let when = chrono::DateTime::from_timestamp_millis(AT - 3_600_000).unwrap().to_rfc3339();
    let mut pay = bank.clone();
    for (k, v) in [("source_ref", json!("payback-test")), ("direction", json!("in")), ("amount", json!(jround(open.amt * 100.0))), ("description", json!("UPI from a friend")),
        ("snippet", json!("UPI from a friend")), ("occurred_at", json!(when)), ("categories", json!({ "name": "Money in" })), ("counted", json!(false))] { pay[k] = v; }
    let paid = make_with(&f, &[pay], &[note, json!({ "txn_ref": "payback-test", "category": null, "for_someone_else": false, "paid_back": true, "note": "" })], None);
    near(paid.owed_back(&paid.all_cards()).total, base.owed_back(&base.all_cards()).total, 0.5, "nothing more to come back than before");
    let ym = time::ym_of(AT);
    near(paid.spend_model(&ym).spend, other.spend_model(&ym).spend, 0.5, "spending unchanged by the payback");
}
