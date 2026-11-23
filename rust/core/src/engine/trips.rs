//! Trips on points (app/trips.js): pick a country, how many of you, how many nights and how comfortable; this works
//! out the points the flights and the hotel cost, and for every card worth considering how much spending earns them,
//! how long that takes at your own spending, what it costs in fees, and whether your income clears the card's bar.

use super::rulebook::{js_sort, rulebook, Country, TripCard};
use super::*;
use crate::fmt::{group_in, money, round};
use crate::time::{local, month_days, parts, ym_of};

pub const TRIP_LEAD: i32 = 2;
pub const TRIP_MAX_MONTHS: i32 = 1200;
pub const TRIP_FAR: i32 = 240;
pub const TRIP_NOMINAL: f64 = 50000.0;
pub const TRIP_NOEARN: [&str; 7] = ["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets"];
const TRIP_SKIP: [&str; 2] = ["Transfers to people", "UPI — payee unknown"];

/// Amounts by kind, in the order they were first seen (a JavaScript object's keys).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ByKind(pub Vec<(String, f64)>);
impl ByKind {
    pub fn get(&self, k: &str) -> Option<f64> { self.0.iter().find(|x| x.0 == k).map(|x| x.1) }
    pub fn g0(&self, k: &str) -> f64 { self.get(k).unwrap_or(0.0) }
    pub fn set(&mut self, k: &str, v: f64) { match self.0.iter_mut().find(|x| x.0 == k) { Some(x) => x.1 = v, None => self.0.push((k.into(), v)) } }
    pub fn add(&mut self, k: &str, v: f64) { let c = self.g0(k); self.set(k, c + v); }
    pub fn remove(&mut self, k: &str) { self.0.retain(|x| x.0 != k); }
    pub fn sum(&self, ks: &[&str]) -> f64 { ks.iter().map(|k| self.g0(k)).sum() }
    pub fn total(&self) -> f64 { self.0.iter().map(|x| x.1).sum() }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
}

/// Your trip (overrides.trip, saved with your settings).
#[derive(Clone, Debug, PartialEq)]
pub struct TripPlan { pub country: String, pub people: i32, pub nights: i32, pub cabin: String, pub stay: bool, pub hotel: usize, pub air: String, pub when: String,
    pub income: Option<f64>, pub spend: Option<f64>, pub travel: Option<f64>, pub night: Option<f64>, pub mine: Vec<String>, pub pts: Vec<(String, f64)> }
impl TripPlan { pub fn pts_of(&self, id: &str) -> f64 { self.pts.iter().find(|x| x.0 == id).map(|x| x.1).unwrap_or(0.0) } }
#[derive(Clone, Debug, PartialEq)]
pub struct Income { pub amt: Option<f64>, pub from: Option<String> }
#[derive(Clone, Debug, PartialEq)]
pub struct Profile { pub by: ByKind, pub n: usize, pub basis: String, pub everyday: f64, pub travel: f64, pub noearn: f64, pub total: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Mix { pub by: ByKind, pub everyday: f64, pub travel: f64, pub noearn: f64, pub earning: f64, pub total: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct AirOpt { pub id: String, pub one_way: f64, pub total: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Need { pub country: Country, pub cabin: String, pub no_business: bool, pub seats: i32, pub rooms: i32, pub people: i32, pub nights: i32, pub airs: Vec<AirOpt>,
    pub preferred: String, pub airline: String, pub flight: AirOpt, pub stay: bool, pub tier: usize, pub usual: f64, pub nightly: f64, pub typed: bool, pub hotel_cost: f64,
    pub per_point: f64, pub accor_pts: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Run { pub months: Option<i32>, pub spend: f64, pub fees: f64, pub bonus: f64, pub per_month: f64, pub counted: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Flight { pub prog: String, pub miles: f64, pub ratio: f64, pub pts: f64, pub one_way: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Hotel { pub points: f64, pub ratio: f64, pub pts: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct TripRow { pub card: TripCard, pub rate: f64, pub owned: bool, pub auto: bool, pub add_on: bool, pub have: f64, pub fl: Option<Flight>, pub ht: Option<Hotel>,
    pub total: f64, pub left: f64, pub run: Option<Run>, pub pace: Option<f64>, pub far: bool, pub can_get: bool, pub ready: Option<Ms>, pub warn: Vec<String> }
#[derive(Clone, Debug, PartialEq)]
pub struct TripModel { pub plan: TripPlan, pub income: Income, pub need: Need, pub prof: Profile, pub mix: Mix, pub known: bool, pub avail: Option<i32>,
    pub all: Vec<TripRow>, pub best: Vec<TripRow>, pub get: Vec<TripRow>, pub yours: Vec<TripRow>, pub off: Vec<TripRow>, pub when_date: Option<Ms> }

/// JavaScript's +v for a saved value.
pub(crate) fn js_num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::Null => 0.0,
        Value::String(s) => { let t = s.trim(); if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) } }
        Value::Array(a) => match a.len() { 0 => 0.0, 1 => js_num(&a[0]), _ => f64::NAN },
        Value::Object(_) => f64::NAN,
    }
}
fn absent(v: Option<&Value>) -> bool { match v { None | Some(Value::Null) => true, Some(Value::String(s)) => s.is_empty(), _ => false } }
/// The first day of the month `n` months after the one `d` is in.
pub fn add_months(d: Ms, n: i32) -> Ms { let p = parts(d); local(p.y, p.m + n, 1) }
pub fn month_name(d: Ms) -> String { let p = parts(d); format!("{} {}", crate::time::MON[p.m as usize], p.y) }

impl Engine {
    pub fn trip_plan(&self) -> TripPlan {
        let empty = Map::new();
        let o = self.overrides.get("trip").and_then(|t| t.as_object()).unwrap_or(&empty);
        let int = |v: Option<&Value>, lo: f64, hi: f64, d: f64| -> f64 { match v { Some(x) if !absent(Some(x)) => { let n = round(js_num(x)); if n.is_finite() { n.max(lo).min(hi) } else { d } } _ => d } };
        let opt = |v: Option<&Value>, hi: f64| -> Option<f64> { match v { Some(x) if !absent(Some(x)) && js_num(x).is_finite() => Some(round(js_num(x)).min(hi).max(0.0)), _ => None } };
        let rb = rulebook();
        let old = if o.contains_key("style") { Some(int(o.get("style"), 0.0, 3.0, 1.0)) } else { None };
        let mut pts: Vec<(String, f64)> = vec![];
        let mut mine: Vec<String> = vec![];
        if let Some(p) = o.get("pts").and_then(|p| p.as_object()) {
            for (id, v) in p { if let Some(n) = opt(Some(v), 1e8).filter(|n| *n != 0.0) { if rb.trip_card(id).is_some() { pts.push((id.clone(), n)); } } }
        }
        if let Some(a) = o.get("mine").and_then(|m| m.as_array()) {
            for v in a { if let Some(id) = v.as_str() { if rb.trip_card(id).is_some() && !mine.iter().any(|m| m == id) { mine.push(id.into()); } } }
        }
        if let Some(card) = o.get("card").and_then(|c| c.as_str()).filter(|c| rb.trip_card(c).is_some()) {
            if !mine.iter().any(|m| m == card) { mine.push(card.into()); }
            if let Some(h) = opt(o.get("have"), 1e8).filter(|h| *h != 0.0) { if !pts.iter().any(|p| p.0 == card) { pts.push((card.into(), h)); } }
        }
        let st = |k: &str| o.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let when = st("when");
        let wok = when.len() == 7 && when.as_bytes()[4] == b'-' && when[..4].chars().all(|c| c.is_ascii_digit()) && when[5..].chars().all(|c| c.is_ascii_digit()) && when > ym_of(self.now());
        TripPlan {
            country: { let c = st("country"); if rb.countries.iter().any(|x| x.id == c) { c } else { "jp".into() } },
            people: int(o.get("people"), 1.0, 6.0, 2.0) as i32, nights: int(o.get("nights"), 1.0, 30.0, 7.0) as i32,
            cabin: { let c = st("cabin"); if c == "j" || c == "y" { c } else if old == Some(3.0) { "j".into() } else { "y".into() } },
            stay: o.get("stay") != Some(&Value::Bool(false)),
            hotel: if o.contains_key("hotel") { int(o.get("hotel"), 0.0, 2.0, 1.0) as usize } else { old.map(|x| x.min(2.0) as usize).unwrap_or(1) },
            air: { let a = st("air"); if a == "ai" || a == "kf" { a } else { String::new() } },
            when: if wok { when } else { String::new() },
            income: opt(o.get("income"), 1e9), spend: opt(o.get("spend"), 1e8), travel: opt(o.get("travel"), 1e8), night: opt(o.get("night"), 1e7),
            mine, pts,
        }
    }
    /// The cards that are yours: tracked by the app (by catalog, or the card's own words in its name), or marked by you.
    /// id → (auto, add-on).
    pub fn trip_held(&self, plan: &TripPlan) -> HashMap<String, (bool, bool)> {
        let mut mine = HashMap::new();
        for g in self.open_groups(None) {
            let gr = &self.groups[&g];
            let name = gr.short.to_lowercase();
            for c in &rulebook().trip_cards {
                if gr.catalog == c.id || (gr.catalog.is_empty() && !c.held.is_empty() && name.contains(&c.held)) { mine.insert(c.id.clone(), (true, name.contains("add-on"))); }
            }
        }
        for id in &plan.mine { mine.entry(id.clone()).or_insert((false, false)); }
        mine
    }
    /// Yearly income for the cards' bars: what you typed, your gross × 12, or your take-home × 12.
    pub fn trip_income(&self, plan: &TripPlan) -> Income {
        if let Some(a) = plan.income { return Income { amt: Some(a), from: Some("you".into()) }; }
        if self.offer.gross > 0.0 { return Income { amt: Some(round(self.offer.gross * 12.0)), from: Some("salary".into()) }; }
        match self.settings.inc.filter(|i| *i != 0.0) { Some(i) => Income { amt: Some(round(i * 12.0)), from: Some("salary".into()) }, None => Income { amt: None, from: None } }
    }
    /// What kind of spending a payment is, for a card's points.
    pub fn trip_kind(desc: &str, cat: &str) -> &'static str {
        let rb = rulebook();
        if rb.trip_re("air").test(desc) { return "air"; }
        if rb.trip_re("ota").test(desc) || (cat == "Travel" && rb.trip_re("stay").test(desc)) { return "ota"; }
        for k in ["fuel", "rent", "insurance", "education", "govt", "wallets", "utilities", "jewellery"] { if rb.trip_re(k).test(desc) { return k; } }
        if cat == "Groceries" { "grocery" } else { "other" }
    }
    fn trip_kinds(rows: &[Row]) -> ByKind {
        let mut by = ByKind::default();
        for x in rows.iter().filter(|x| x.t.dir == "out" && x.t.counted && !TRIP_SKIP.contains(&x.t.cat.as_str())) { by.add(Self::trip_kind(&x.t.desc, &x.t.cat), x.t.amt); }
        by
    }
    /// A month of your spending by kind: the average of your last three full months (or this month so far, scaled up).
    pub fn trip_profile(&self) -> Profile {
        let now = self.now(); let cur = ym_of(now);
        let full: Vec<ByKind> = self.months().into_iter().filter(|k| *k < cur).take(3).map(|k| Self::trip_kinds(&self.tx_for(Some(&k), false))).filter(|b| !b.is_empty()).collect();
        let mut by = ByKind::default(); let mut n = full.len(); let mut basis = "none";
        if n > 0 {
            for m in &full { for (k, v) in &m.0 { by.add(k, v / n as f64); } }
            basis = "months";
        } else {
            let m = Self::trip_kinds(&self.tx_for(Some(&cur), false));
            let p = parts(now); let (day, dim) = (p.d, month_days(p.y, p.m));
            if !m.is_empty() { let up = if day >= 7 { dim as f64 / day as f64 } else { 1.0 }; for (k, v) in &m.0 { by.set(k, v * up); } basis = "month"; n = 1; }
        }
        for x in by.0.iter_mut() { x.1 = round(x.1); }
        let travel = by.sum(&["air", "ota"]); let noearn = by.sum(&TRIP_NOEARN);
        let everyday = by.total() - travel - noearn;
        Profile { by, n, basis: basis.into(), everyday, travel, noearn, total: everyday + travel + noearn }
    }
    /// The month of spending the cards are worked out on: yours, with anything you typed in its place.
    pub fn trip_mix(plan: &TripPlan, prof: &Profile) -> Mix {
        let mut by = prof.by.clone();
        if let Some(s) = plan.spend {
            let keep: Vec<String> = by.0.iter().map(|x| x.0.clone()).filter(|k| k == "air" || k == "ota" || TRIP_NOEARN.contains(&k.as_str())).collect();
            by.0.retain(|x| keep.contains(&x.0));
            by.set("other", s);
        }
        if let Some(t) = plan.travel {
            let (a, o) = (prof.by.g0("air"), prof.by.g0("ota"));
            let share = if a + o > 0.0 { a / (a + o) } else { 0.5 };
            let air = round(t * share);
            by.set("air", air); by.set("ota", t - air);
        }
        let travel = by.g0("air") + by.g0("ota"); let noearn = by.sum(&TRIP_NOEARN); let total = by.total();
        Mix { by, everyday: total - travel - noearn, travel, noearn, earning: total - noearn, total }
    }
    /// What the trip costs in points.
    pub fn trip_need(plan: &TripPlan) -> Need {
        let rb = rulebook();
        let c = rb.country(&plan.country).clone();
        let priced = |cab: &str| -> Vec<&str> { ["ai", "kf"].into_iter().filter(|p| c.award(p).and_then(|a| a.of(cab)).is_some()).collect() };
        let no_business = plan.cabin == "j" && priced("j").is_empty();
        let cabin = if no_business { "y".to_string() } else { plan.cabin.clone() };
        let seats = plan.people * 2; let rooms = (plan.people as f64 / 2.0).ceil() as i32;
        let mut airs: Vec<AirOpt> = priced(&cabin).into_iter().map(|p| { let o = c.award(p).unwrap().of(&cabin).unwrap(); AirOpt { id: p.into(), one_way: o, total: o * seats as f64 } }).collect();
        airs.sort_by(|a, b| a.one_way.partial_cmp(&b.one_way).unwrap());
        let airline = if airs.iter().any(|a| a.id == plan.air) { plan.air.clone() } else { airs[0].id.clone() };
        let flight = airs.iter().find(|a| a.id == airline).unwrap().clone();
        let usual = round(c.hotel[plan.hotel] * rb.usd / 50.0) * 50.0;
        let nightly = plan.night.filter(|n| *n > 0.0).unwrap_or(usual);
        let hotel_cost = if plan.stay { nightly * rooms as f64 * plan.nights as f64 } else { 0.0 };
        let per_point = rb.accor_eur * rb.eur / rb.accor_per;
        let accor_pts = (hotel_cost / per_point / rb.accor_per).ceil() * rb.accor_per;
        Need { preferred: airs[0].id.clone(), country: c, cabin, no_business, seats, rooms, people: plan.people, nights: plan.nights, airs, airline, flight, stay: plan.stay,
            tier: plan.hotel, usual, nightly, typed: nightly != usual, hotel_cost, per_point, accor_pts }
    }
    /// Points and counted spending from one month of `by` on a card.
    pub fn trip_earn(card: &TripCard, by: &ByKind) -> (f64, f64) {
        let (mut pts, mut spend) = (0.0, 0.0);
        for (k, amt) in &by.0 {
            if !(*amt > 0.0) || card.no.iter().any(|n| n == k) { continue; }
            let mut p = amt * (if k == "air" { card.earn.air } else if k == "ota" { card.earn.ota } else { card.earn.base }) / 100.0;
            if let Some(cap) = card.cap.get(k).and_then(|v| v.as_f64()).filter(|c| *c != 0.0) { p = p.min(cap); }
            pts += p; spend += amt;
        }
        (pts, spend)
    }
    pub fn trip_fee(card: &TripCard) -> f64 { round(card.fee * 1.18) }
    /// Months of this spending until the card holds `need` points (None: never).
    pub fn trip_run(card: &TripCard, need: f64, by: &ByKind, have: f64, owned: bool) -> Run {
        let (e_pts, e_spend) = Self::trip_earn(card, by);
        let wel = card.welcome.as_ref();
        let ms = &card.milestones;
        let (mut pts, mut m, mut yr, mut q, mut total) = (have, 0, 0.0, 0.0, 0.0);
        let mut fees = if owned { 0.0 } else { Self::trip_fee(card) };
        let mut bonus = 0.0; let mut got = owned || wel.is_none(); let mut hit: HashSet<usize> = HashSet::new();
        let done = |pts: f64| pts + 1e-6 >= need;
        if let Some(w) = wel { if !owned && w.spend <= 0.0 { pts += w.pts; bonus += w.pts; got = true; } }
        while !done(pts) && m < TRIP_MAX_MONTHS {
            m += 1; pts += e_pts; yr += e_spend; q += e_spend; total += e_spend;
            if let Some(w) = wel { if !got && m as f64 <= round(w.days / 30.0).max(1.0) && total >= w.spend { pts += w.pts; bonus += w.pts; got = true; } }
            for (i, x) in ms.iter().enumerate() { if x.per == "year" && !hit.contains(&i) && yr >= x.at { hit.insert(i); pts += x.pts; bonus += x.pts; } }
            if m % 3 == 0 { for x in ms { if x.per == "quarter" && q >= x.at { pts += x.pts; bonus += x.pts; } } q = 0.0; }
            if done(pts) { break; }
            if m % 12 == 0 {
                if !(card.waive.map(|w| w != 0.0 && yr >= w).unwrap_or(false)) { fees += Self::trip_fee(card); }
                if let Some(r) = card.renewal.filter(|r| *r != 0.0) { pts += r; bonus += r; }
                yr = 0.0; hit.clear();
            }
        }
        Run { months: if done(pts) { Some(m) } else { None }, spend: round(total), fees, bonus, per_month: e_pts, counted: e_spend }
    }
    /// `by` scaled so the counted spending on this card is `monthly` (all everyday when there's nothing to scale).
    pub fn trip_scaled(card: &TripCard, by: &ByKind, monthly: f64) -> ByKind {
        let (_, spend) = Self::trip_earn(card, by);
        if !(spend > 0.0) { return ByKind(vec![("other".into(), monthly)]); }
        let f = monthly / spend;
        ByKind(by.0.iter().filter(|x| !card.no.iter().any(|n| *n == x.0)).map(|x| (x.0.clone(), x.1 * f)).collect())
    }
    /// The counted spending a month that reaches `need` within `months` (to the next ₹500), or None.
    pub fn trip_pace(card: &TripCard, need: f64, by: &ByKind, have: f64, owned: bool, months: i32) -> Option<f64> {
        if months < 1 { return None; }
        let ok = |v: f64| { let r = Self::trip_run(card, need, &Self::trip_scaled(card, by, v), have, owned); r.months.map(|m| m <= months).unwrap_or(false) };
        let (mut lo, mut hi) = (0.0, 5e6);
        if ok(0.0) { return Some(0.0); }
        if !ok(hi) { return None; }
        for _ in 0..40 { let mid = (lo + hi) / 2.0; if ok(mid) { hi = mid; } else { lo = mid; } }
        Some((hi / 500.0).ceil() * 500.0)
    }
    /// One card against the trip on the chosen airline.
    pub fn trip_card(&self, card: &TripCard, need: &Need, mix: &Mix, plan: &TripPlan, income: &Income, avail: Option<i32>, held: &HashMap<String, (bool, bool)>) -> TripRow {
        let rb = rulebook();
        let air = &need.airline;
        let r = card.to_of(air);
        let fl = r.map(|r| Flight { prog: air.clone(), miles: need.flight.total, ratio: r, pts: (need.flight.total * r).ceil(), one_way: need.flight.one_way });
        let ht = if need.stay { card.to_of("accor").map(|a| Hotel { points: need.accor_pts, ratio: a, pts: (need.accor_pts * a).ceil() }) } else { None };
        let total = fl.as_ref().map(|f| f.pts).unwrap_or(0.0) + ht.as_ref().map(|h| h.pts).unwrap_or(0.0);
        let mine = held.get(&card.id).copied();
        let owned = mine.is_some(); let have = plan.pts_of(&card.id);
        let known = mix.earning > 0.0;
        let by = if known { mix.by.clone() } else { ByKind(vec![("other".into(), TRIP_NOMINAL)]) };
        let run = fl.as_ref().map(|_| Self::trip_run(card, total, &by, have, owned));
        let pace = if fl.is_some() { avail.and_then(|a| Self::trip_pace(card, total, &by, have, owned, a)) } else { None };
        let can_get = card.status == "open" && !(income.amt.is_some() && card.income.map(|i| i != 0.0).unwrap_or(false) && income.amt.unwrap() < card.income.unwrap());
        let mut warn = vec![];
        if fl.is_none() { warn.push(format!("Its points don't move to {}.", rb.airline(air).short)); }
        if need.stay && ht.is_none() { warn.push(format!("No hotel partner: the {} hotel would be paid in cash.", money(need.hotel_cost))); }
        if let Some(ca) = card.cap_a.filter(|c| *c != 0.0 && total > *c) { warn.push(format!("Axis moves at most {} {} a year to these partners, so the transfers take {} calendar years.", group_in(ca as u64), card.pts, (total / ca).ceil())); }
        if let (Some(ex), Some(Run { months: Some(m), .. })) = (card.expire.filter(|e| *e != 0.0), run.as_ref()) { if *m as f64 > ex { warn.push(format!("{} expire after {} months, so the earliest would lapse before you get there.", card.pts, ex)); } }
        let far = run.as_ref().map(|r| r.months.map(|m| m > TRIP_FAR).unwrap_or(true)).unwrap_or(false);
        if far { warn.push("More than 20 years away at this spending.".into()); }
        if mine.map(|m| m.1).unwrap_or(false) { warn.push("Yours is an add-on card: the points sit with the main cardholder, who makes the transfer.".into()); }
        let ready = match &run { Some(Run { months: Some(m), .. }) if !far => Some(add_months(self.now(), *m)), _ => None };
        TripRow { card: card.clone(), rate: r.map(|r| card.earn.base / r).unwrap_or(0.0), owned, auto: mine.map(|m| m.0).unwrap_or(false), add_on: mine.map(|m| m.1).unwrap_or(false),
            have, fl, ht, total, left: (total - have).max(0.0), run, pace, far, can_get, ready, warn }
    }
    /// Everything the Trips screen shows.
    pub fn trip_model(&self) -> TripModel {
        let rb = rulebook();
        let plan = self.trip_plan(); let income = self.trip_income(&plan); let need = Self::trip_need(&plan); let prof = self.trip_profile();
        let mix = Self::trip_mix(&plan, &prof); let held = self.trip_held(&plan);
        let now = parts(self.now());
        let avail = if plan.when.is_empty() { None } else {
            let y: i32 = plan.when[..4].parse().unwrap(); let m: i32 = plan.when[5..7].parse().unwrap();
            Some((y - now.y) * 12 + (m - 1 - now.m) - TRIP_LEAD)
        };
        let all: Vec<TripRow> = rb.trip_cards.iter().filter(|c| !rb.trip_left_out.contains(&c.id) || held.contains_key(&c.id))
            .map(|c| self.trip_card(c, &need, &mix, &plan, &income, avail, &held)).collect();
        let mut best: Vec<TripRow> = all.iter().filter(|r| r.fl.is_some()).cloned().collect();
        js_sort(&mut best, |a, b| { let d = b.rate - a.rate; if d != 0.0 { return d; } let f = a.card.fee - b.card.fee; if f != 0.0 { return f; } if a.card.name < b.card.name { -1.0 } else { 1.0 } });
        let when_date = if plan.when.is_empty() { None } else { Some(local(plan.when[..4].parse().unwrap(), plan.when[5..7].parse::<i32>().unwrap() - 1, 1)) };
        TripModel { known: mix.earning > 0.0, get: best.iter().filter(|r| r.can_get).cloned().collect(), yours: all.iter().filter(|r| r.owned).cloned().collect(),
            off: all.iter().filter(|r| r.fl.is_none()).cloned().collect(), plan, income, need, prof, mix, avail, all, best, when_date }
    }

    /* ---------------- actions ---------------- */
    /// Change one thing about the trip (a null or empty value puts it back).
    pub fn set_trip(&mut self, k: &str, v: Value) {
        let mut o = self.overrides.get("trip").and_then(|t| t.as_object()).cloned().unwrap_or_default();
        if o.contains_key("style") || o.contains_key("card") {
            // an older plan: keep what it meant, in today's fields
            let p = self.trip_plan();
            o.insert("cabin".into(), Value::from(p.cabin.clone())); o.insert("hotel".into(), Value::from(p.hotel as i64));
            if !p.mine.is_empty() { o.insert("mine".into(), Value::from(p.mine.clone())); }
            if !p.pts.is_empty() { o.insert("pts".into(), Value::Object(p.pts.iter().map(|(k, v)| (k.clone(), jnum(*v))).collect())); }
            o.remove("style"); o.remove("card"); o.remove("have");
        }
        if absent(Some(&v)) { o.remove(k); } else { o.insert(k.into(), v); }
        if ["country", "hotel", "people", "nights"].contains(&k) { o.remove("night"); }
        if k == "country" || k == "cabin" { o.remove("air"); }
        self.overrides.insert("trip".into(), Value::Object(o));
        self.derive_lists(); self.resolve_payments(); self.unsaved = true;
    }
    /// Mark a card as yours (or not), and the points on it now.
    pub fn set_trip_card(&mut self, id: &str, mine: bool, pts: f64) {
        let p = self.trip_plan();
        let mut m: Vec<String> = p.mine.iter().filter(|x| *x != id).cloned().collect();
        let mut q = p.pts.clone();
        if mine { m.push(id.into()); }
        if pts > 0.0 { let r = round(pts); match q.iter_mut().find(|x| x.0 == id) { Some(x) => x.1 = r, None => q.push((id.into(), r)) } } else { q.retain(|x| x.0 != id); }
        self.set_trip("mine", if m.is_empty() { Value::Null } else { Value::from(m) });
        self.set_trip("pts", if q.is_empty() { Value::Null } else { Value::Object(q.iter().map(|(k, v)| (k.clone(), jnum(*v))).collect()) });
    }
    pub fn reset_trip(&mut self) { self.overrides.remove("trip"); self.derive_lists(); self.resolve_payments(); self.unsaved = true; }
}
