//! Rewards (app/rewards.js): which card to pay with. A spend you describe ("a new phone on Amazon for 80k"), every
//! card you hold and every card you could get on your income, each paid every way it can be (straight on the card, a
//! bank's portal, a brand voucher, Amazon Pay), with bonus rates, spending that earns nothing and the caps; what this
//! month earned on each card; what a better card would have earned; your next card; milestones and fee waivers.

use super::rulebook::{js_sort, rulebook, Cap, RewCard};
use super::*;
use crate::fmt::{group_in, locale_in, round};
use crate::time::{local, month_days, parts, ym_of};
use regex::Regex;
use std::sync::OnceLock;

pub const REW_DEFAULT_AMT: f64 = 1000.0;
/// The searches the parity check makes (tools/rust/screens.mjs SEARCHES).
pub const CHECK_SEARCHES: [&str; 18] = ["a new iPhone for 80k", "dinner at a restaurant ₹2,500", "flights to Japan", "swiggy order 600", "groceries on bigbasket", "hotel in Bangkok 12000",
    "netflix", "shoes in store 3000", "petrol 2000", "USD 120 on amazon.com", "uber", "1.5 lakh laptop on flipkart", "coffee in Singapore",
    "12.5k on non smartbuy hotel", "hotel 8000 booked direct", "flight 20k not on makemytrip", "amazon shopping 5000 without amazon pay", "12.5k hotel on smartbuy"];
const REW_SKIP: [&str; 2] = ["Transfers to people", "UPI — payee unknown"];

/// A spend: what you typed (or a transaction), as the rulebook reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Spend { pub text: String, pub amt: Option<f64>, pub kind: String, pub shop: Option<String>, pub online: bool, pub intl: bool, pub route: String,
    /// shops and portals your words rule out ("non SmartBuy", "booked direct"), as rewNot
    pub not: Vec<String> }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Worth { pub cash: f64, pub miles: f64, pub partner: Option<String>, pub best: f64 }
/// One way to pay with one card.
#[derive(Clone, Debug, PartialEq)]
pub struct Way { pub route: String, pub label: String, pub how: String, pub rate: f64, pub pts: f64, pub extra: f64, pub capped: bool, pub caps: Vec<Cap>,
    pub notes: Vec<String>, pub free: bool, pub worth: Worth, pub fee: Option<f64>, pub net: f64, pub at: Option<String> }
#[derive(Clone, Debug, PartialEq)]
pub struct Held { pub g: String, pub short: String, pub card: Option<&'static RewCard>, pub add_on: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct Prefs { pub prime: bool, pub ai: f64, pub kf: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct How { pub key: String, pub text: String, pub why: String }
#[derive(Clone, Debug, PartialEq)]
pub struct EarnItem { pub id: String, pub desc: String, pub ts: Ms, pub ym: String, pub day: i32, pub amt: f64, pub kind: String, pub pts: f64, pub capped: bool,
    pub how: String, pub why: String, pub for_other: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct WayGroup { pub key: String, pub text: String, pub why: String, pub n: usize, pub amt: f64, pub pts: f64, pub none: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct CapUse { pub id: String, pub name: String, pub max: f64, pub per: String, pub on: String, pub used: f64 }
/// This month on one card you hold.
#[derive(Clone, Debug, PartialEq)]
pub struct MonthCard { pub g: String, pub short: String, pub card: Option<&'static RewCard>, pub add_on: bool, pub pts: f64, pub spent: f64, pub n: usize,
    pub used: HashMap<String, f64>, pub caps: Vec<CapUse>, pub worth: Option<Worth>, pub items: Vec<EarnItem>, pub ways: Vec<WayGroup>, pub full: Option<CapUse> }
#[derive(Clone, Debug, PartialEq)]
pub struct SearchCard { pub g: Option<String>, pub short: String, pub card: &'static RewCard, pub add_on: bool, pub ways: Vec<Way>, pub best: Option<Way>, pub mine: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct Search { pub sp: Spend, pub typed_amt: bool, pub yours: Vec<SearchCard>, pub could: Vec<SearchCard>, pub top: Option<SearchCard>, pub runner: Option<SearchCard>,
    pub better: Option<SearchCard>, pub unknown: Vec<MonthCard>, pub income: Income }
#[derive(Clone, Debug, PartialEq)]
pub struct Miss { pub x: Row, pub real: f64, pub real_pts: f64, pub used: Option<&'static RewCard>, pub best: f64, pub best_pts: f64, pub card: Option<&'static RewCard>, pub kind: String, pub gap: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct TipFrom { pub key: String, pub card: Option<&'static RewCard>, pub short: String, pub pts: f64, pub worth: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Tip { pub card: &'static RewCard, pub short: String, pub kind: String, pub kind_name: String, pub n: usize, pub amt: f64, pub gap: f64, pub best_pts: f64,
    pub from: Vec<TipFrom>, pub list: Vec<Miss> }
#[derive(Clone, Debug, PartialEq)]
pub struct Missed { pub got: f64, pub could: f64, pub gap: f64, pub misses: Vec<Miss>, pub tips: Vec<Tip>, pub n: usize, pub cards: usize }
#[derive(Clone, Debug, PartialEq)]
pub struct NextRow { pub card: &'static RewCard, pub year: f64, pub fee: f64, pub net: f64, pub spend_year: f64, pub pts_year: f64, pub top: Vec<String>, pub waived: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct Next { pub rows: Vec<NextRow>, pub basis: String, pub n: usize, pub income: Income, pub spent: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct GoalItem { pub g: String, pub short: String, pub card: &'static RewCard, pub add_on: bool, pub what: String, pub worth: f64, pub per: String, pub target: f64, pub done: f64, pub fee: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct RewardsModel { pub month: Vec<MonthCard>, pub missed: Missed, pub next: Next, pub goals: Vec<GoalItem>, pub prefs: Prefs, pub income: Income }

fn re(s: &str) -> Regex { Regex::new(&format!("(?i){}", s)).unwrap() }
/// "1,000" for points.
pub fn rew_pts(n: f64) -> String { let r = round(n); if r < 0.0 { format!("-{}", group_in((-r) as u64)) } else { group_in(r as u64) } }
/// "2.5 per ₹100" on a points card, "5%" on a cashback card.
pub fn rew_rate_text(card: &RewCard, rate: f64) -> String { let r = round(rate * 100.0) / 100.0; if card.unit == "points" { format!("{} per ₹100", locale_in(r)) } else { format!("{}%", locale_in(r)) } }
/// The start of the cap period `per` that `ts` falls in.
pub fn rew_period(per: &str, ts: Ms) -> String { let p = parts(ts); if per == "quarter" { format!("{}-Q{}", p.y, p.m / 3) } else { format!("{}-{}", p.y, p.m) } }
pub fn rew_key(cap: &Cap, ts: Ms) -> String { format!("{}@{}", cap.id, rew_period(&cap.per, ts)) }
/// Count `w` toward its caps.
pub fn rew_use(used: &mut HashMap<String, f64>, w: &Way, at: Ms) { for cp in &w.caps { *used.entry(rew_key(cp, at)).or_insert(0.0) += if cp.on == "extra" { w.extra } else { w.pts }; } }
fn can_get(c: &RewCard, inc: &Income) -> bool {
    c.status == "open" && !rulebook().left_out.contains(&c.id) && !(inc.amt.is_some() && c.income.map(|i| i != 0.0).unwrap_or(false) && inc.amt.unwrap() < c.income.unwrap())
}
fn spends(list: Vec<Row>) -> Vec<Row> {
    let mut v: Vec<Row> = list.into_iter().filter(|x| x.t.dir == "out" && x.t.counted && x.refunded.is_none() && !REW_SKIP.contains(&x.t.cat.as_str()) && x.t.amt > 0.0).collect();
    v.sort_by_key(|x| x.t.ts);
    v
}

/// The shops and portals your words rule out (ids): rewNot. A "not" word just before a shop's or portal's name leaves it
/// out; "booked direct" / "on the hotel's website" leaves out every portal and travel site.
pub fn rew_not(t: &str) -> Vec<String> {
    let rb = rulebook();
    static R: OnceLock<(Regex, Vec<(&'static str, Regex)>, Regex)> = OnceLock::new();
    let (not_re, routes, direct_re) = R.get_or_init(|| (
        re(r"(?:^|\b)(?:non|not|no|without|outside(?: of)?|except|excluding|other than|apart from|avoid(?:ing)?|instead of|skip(?:ping)?)(?:[\s-]+(?:on|via|through|using|from|at|the|a|an|by|with))*[\s-]*$"),
        vec![("traveledge", re(r"\b(axis\s+)?travel\s?edge\b")), ("hsbcapp", re(r"\bhsbc\s+(travel\s+with\s+points|app)\b")), ("amazonpay", re(r"\bamazon\s?pay\b"))],
        re(r"\b(book(ed|ing)?\s+(it\s+)?direct(ly)?|direct(ly)?\s+(with|on|from|at|through)\s+(the\s+)?(hotel|airline|property|brand)|(hotel|airline|brand)('s)?\s+(own\s+)?(website|site|app)|direct\s+booking)\b"),
    ));
    let mut not: Vec<String> = vec![];
    for s in &rb.shops { if let Some(i) = s.re.find_start(t) { if not_re.is_match(&t[..i]) { not.push(s.id.clone()); } } }
    for (id, r) in routes { if let Some(m) = r.find(t) { if not_re.is_match(&t[..m.start()]) { not.push(id.to_string()); } } }
    if direct_re.is_match(t) { for id in ["smartbuy", "traveledge", "hsbcapp", "makemytrip", "cleartrip", "goibibo"] { if !not.iter().any(|x| x == id) { not.push(id.into()); } } }
    not
}

/// What you typed, as a spend.
pub fn rew_parse(text: &str) -> Spend {
    let rb = rulebook();
    let t = text.trim().to_string(); let low = t.to_lowercase();
    static AMT: OnceLock<Regex> = OnceLock::new();
    let amt_re = AMT.get_or_init(|| re(r"(₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k\b|thousand|lakhs?|lacs?|l\b|cr\b|crores?)?"));
    let mut amt = None;
    for m in amt_re.captures_iter(&t) {
        let n = parse_float(&m[2].replace(',', ""));
        if !n.is_finite() { continue; }
        let unit = m.get(3).map(|u| u.as_str().to_lowercase()).unwrap_or_default();
        let mult = if unit.starts_with('k') || unit.contains("thousand") { 1e3 } else if unit.starts_with('l') { 1e5 } else if unit.starts_with('c') { 1e7 } else { 1.0 };
        let v = n * mult;
        if m.get(1).is_some() || !unit.is_empty() || v >= 100.0 { amt = Some(round(v)); break; }
    }
    let not = rew_not(&t);
    let shop = rb.shops.iter().find(|s| !not.contains(&s.id) && s.re.test(&t));
    let mut kind: Option<String> = rb.kinds.iter().find(|k| k.re.as_ref().map(|r| r.test(&t)).unwrap_or(false)).map(|k| k.id.clone());
    if let Some(s) = shop {
        let keeps = kind.as_ref().map(|k| s.sells.contains(k)).unwrap_or(false);
        let travel = (kind.as_deref() == Some("flights") || kind.as_deref() == Some("hotels")) && s.kind == "travel";
        if !keeps && !travel { kind = Some(s.kind.clone()); }
    }
    let kind = kind.unwrap_or_else(|| "other".into());
    let mut places: Vec<String> = rb.countries.iter().flat_map(|c| vec![c.name.clone(), c.city.split(',').next().unwrap_or("").to_string(), c.city.split(" or ").next().unwrap_or("").to_string()]).collect();
    places.push("abroad".into()); places.push("overseas".into());
    let place_re = re(&format!(r"\b(in|at) ({})\b", places.iter().map(|p| regex::escape(&p.to_lowercase())).collect::<Vec<_>>().join("|")));
    static INTL: OnceLock<Regex> = OnceLock::new();
    let intl_re = INTL.get_or_init(|| re(r"\b(usd|dollars?|euros?|pounds?|yen|dirhams?|forex|foreign currency|international (spend|purchase|transaction))\b|[$€£¥]"));
    let intl = intl_re.is_match(&t) || (!["flights", "hotels", "travel"].contains(&kind.as_str()) && place_re.is_match(&low));
    static ON: OnceLock<(Regex, Regex)> = OnceLock::new();
    let (on_re, off_re) = ON.get_or_init(|| (re(r"\b(online|website|app|order(ed|ing)?)\b"), re(r"\b(in[- ]store|offline|in person|at the (shop|store|mall)|showroom|outlet|walk[- ]in)\b")));
    let mut online = None;
    if on_re.is_match(&t) { online = Some(true); }
    if off_re.is_match(&t) { online = Some(false); }
    let online = online.unwrap_or_else(|| match shop { Some(s) => s.online != Some(false), None => rb.online.contains(&kind) });
    Spend { text: t, amt, kind, shop: shop.map(|s| s.id.clone()), online, intl, route: "card".into(), not }
}

impl Engine {
    /// Your open card accounts, each with its rulebook card (None when the rulebook doesn't have it).
    pub fn rew_held(&self) -> Vec<Held> {
        let rb = rulebook();
        self.open_groups(None).into_iter().map(|g| {
            let gr = &self.groups[&g];
            let name = gr.short.to_lowercase();
            let card = rb.rew_card(&gr.catalog).or_else(|| rb.rew_cards.iter().find(|c| c.held.as_deref().map(|h| !h.is_empty() && name.contains(h)).unwrap_or(false)));
            Held { short: gr.short.clone(), card, add_on: name.contains("add-on"), g }
        }).collect()
    }
    /// Your settings for this tab (overrides.rew): Prime, and what a partner point is worth.
    pub fn rew_prefs(&self) -> Prefs {
        let rb = rulebook();
        let o = self.overrides.get("rew").and_then(|r| r.as_object());
        let v = |k: &str, d: f64| o.and_then(|o| o.get(k)).and_then(|x| x.as_f64()).filter(|x| x.is_finite() && *x >= 0.0 && *x <= 10.0).unwrap_or(d);
        Prefs { prime: o.and_then(|o| o.get("prime")) != Some(&Value::Bool(false)), ai: v("ai", rb.value_ai), kf: v("kf", rb.value_kf) }
    }
    pub fn rew_partner_value(&self, p: &str) -> f64 {
        let rb = rulebook(); let pr = self.rew_prefs();
        match p { "ai" => pr.ai, "kf" => pr.kf, "accor" => rb.accor_eur * rb.eur / rb.accor_per, _ => 0.0 }
    }
    /// What `pts` of this card are worth: cash, moved to a partner, and the better of the two.
    pub fn rew_worth(&self, card: &RewCard, pts: f64) -> Worth {
        let cash = pts * card.cash.as_ref().map(|c| c.per).unwrap_or(0.0);
        let (mut miles, mut partner) = (0.0, None);
        if card.unit == "points" {
            if let Some(to) = &card.to {
                for (p, r) in to { let Some(r) = r.as_f64().filter(|r| *r != 0.0) else { continue }; let v = pts / r * self.rew_partner_value(p); if v > miles { miles = v; partner = Some(p.clone()); } }
            }
        }
        Worth { cash, miles, partner, best: cash.max(miles) }
    }
    /// Every way to pay for `sp` with `card`, best first. used: points used toward each cap this period.
    pub fn rew_ways(&self, card: &RewCard, sp: &Spend, used: &HashMap<String, f64>, at: Ms) -> Vec<Way> {
        let rb = rulebook();
        let amt = sp.amt.unwrap_or(0.0); let kind = sp.kind.as_str();
        let shop = sp.shop.as_deref().and_then(|s| rb.shop(s));
        let p = self.rew_prefs();
        let mut out: Vec<Way> = vec![];
        if !(amt > 0.0) { return out; }
        if let Some(min) = card.min.filter(|m| *m != 0.0 && amt < *m) {
            return vec![Way { route: "card".into(), label: "On the card".into(), how: "Pay with the card".into(), pts: 0.0, extra: 0.0, rate: 0.0, caps: vec![],
                notes: vec![format!("Spends under ₹{} earn nothing on this card.", min)], capped: false, free: false, worth: self.rew_worth(card, 0.0), fee: None, net: 0.0, at: None }];
        }
        let base = card.base;
        let earns_nothing = card.no.iter().any(|k| k == kind);
        let cap_of = |mut pts: f64, mut extra: f64, caps: &[Cap]| -> (f64, f64, bool) {
            let mut capped = false;
            for cp in caps {
                let left = (cp.max - used.get(&rew_key(cp, at)).copied().unwrap_or(0.0)).max(0.0);
                if cp.on == "extra" { if extra > left { pts -= extra - left; extra = left; capped = true; } }
                else if pts > left { let cut = pts - left; pts = left; extra = (extra - cut).max(0.0); capped = true; }
            }
            (pts, extra, capped)
        };
        let mut add = |route: &str, label: String, how: &str, rate: f64, caps: Vec<Option<Cap>>, mut notes: Vec<String>, day: Option<f64>, free: bool| {
            let mut pts = amt * rate / 100.0; let mut extra = (amt * (rate - base) / 100.0).max(0.0);
            if let Some(d) = day.filter(|d| *d != 0.0 && extra > *d) { pts -= extra - d; extra = d; notes.push(format!("At most {} extra points a day.", rew_pts(d))); }
            let caps: Vec<Cap> = caps.into_iter().flatten().collect();
            let (pts, extra, capped) = cap_of(pts, extra, &caps);
            out.push(Way { route: route.into(), label, how: how.into(), rate, pts, extra, capped, caps, notes, free, worth: Worth::default(), fee: None, net: 0.0, at: None });
        };
        // straight on the card
        'direct: {
            let mut notes: Vec<String> = vec![];
            if sp.intl {
                let r = card.intl.unwrap_or(base);
                if r == 0.0 { add("card", "On the card".into(), "Pay with the card", 0.0, vec![], vec!["Foreign-currency spending earns nothing on this card.".into()], None, false); break 'direct; }
                add("card", "On the card".into(), "Pay with the card", r, vec![card.cap.clone()], notes, None, false); break 'direct;
            }
            if earns_nothing || card.no_direct.iter().any(|k| k == kind) {
                let why = card.maybe_for(kind).filter(|m| !m.is_empty()).unwrap_or_else(|| format!("{} earns nothing on this card.", rb.kind(kind).name));
                add("card", "On the card".into(), "Pay with the card", 0.0, vec![], vec![why], None, false); break 'direct;
            }
            let (mut rate, mut label) = (base, "On the card".to_string());
            let mut caps: Vec<Option<Cap>> = vec![card.cap.clone()];
            if let Some(kc) = card.kind_cap.get(kind).and_then(|v| v.as_f64()).filter(|v| *v != 0.0) { caps.push(Some(Cap { id: format!("{}-{}", card.id, kind), max: kc, per: "month".into(), on: "total".into() })); }
            for b in &card.bonus {
                if let Some(ms) = &b.merchants { if !shop.map(|s| ms.contains(&s.id)).unwrap_or(false) { continue; } }
                if let Some(ks) = &b.kinds { if !ks.iter().any(|k| k == kind) { continue; } }
                if let (Some(ex), Some(s)) = (&b.except, shop) { if ex.contains(&s.id) { continue; } }
                if b.online && !sp.online { continue; }
                if let (Some(d), Some(s)) = (&b.direct, shop) { if d.iter().any(|k| k == kind) && !s.airline { continue; } }
                if b.via_ota && !shop.map(|s| s.kind == "travel").unwrap_or(false) { continue; }
                if let Some(m) = b.min.filter(|m| *m != 0.0) { if amt < m { continue; } }
                let r = match b.prime.filter(|p| *p != 0.0) { Some(pr) if !p.prime => pr, _ => b.rate };
                if r > rate {
                    rate = r; label = b.label.clone();
                    let mut next: Vec<Option<Cap>> = if b.own { vec![] } else { vec![card.cap.clone()] };
                    next.extend(caps.iter().skip(1).cloned());
                    if let Some(c) = &b.cap { next.push(Some(c.clone())); }
                    caps = next;
                }
            }
            if let Some(m) = card.maybe_for(kind).filter(|m| !m.is_empty()) { notes.push(m); }
            add("card", label, "Pay with the card", rate, caps, notes, None, false);
        }
        if !sp.intl {
            for r in &card.routes {
                if sp.not.contains(&r.id) { continue; }          // a portal you said you're not using
                let notes: Vec<String> = r.note.clone().map(|n| vec![n]).unwrap_or_default();
                if let Some(v) = r.kinds.as_ref().and_then(|k| k.get(kind)).and_then(|v| v.as_f64()) {
                    add(&r.id, format!("{} · {}", r.label, rb.kind(kind).name.to_lowercase()), &r.how, v, vec![r.cap.clone()], notes.clone(), r.day, true);
                }
                if let Some(s) = shop {
                    if let Some(v) = r.merchants.as_ref().and_then(|m| m.get(&s.id)).and_then(|v| v.as_f64()) { add(&r.id, format!("{} · {}", r.label, s.name), &r.how, v, vec![r.cap.clone()], notes.clone(), r.day, false); }
                    if s.voucher && !earns_nothing { if let Some(v) = r.voucher {
                        let mut n2 = notes.clone(); n2.push(format!("Check {} sells {} vouchers today, and the voucher's own discount.", r.label, s.name));
                        add(&format!("{}-v", r.id), format!("{} · {} voucher", r.label, s.name), &format!("Buy a {} gift voucher on {}, then pay with the voucher", s.name, r.label), v, vec![r.cap.clone(), r.vcap.clone()], n2, r.day, false);
                    } }
                    if let Some(v) = r.partners { if s.ap { add(&r.id, format!("{} at {}", r.label, s.name), &r.how, v, vec![], notes.clone(), None, false); } }
                }
            }
        }
        for o in out.iter_mut() {
            o.worth = self.rew_worth(card, o.pts);
            if sp.intl { if let Some(fx) = card.fx.filter(|f| *f != 0.0) { o.fee = Some(amt * fx / 100.0); } }
            o.net = o.worth.best - o.fee.unwrap_or(0.0);
        }
        js_sort(&mut out, |a, b| { let d = b.net - a.net; if d != 0.0 { d } else if a.route == "card" { -1.0 } else { 1.0 } });
        out
    }

    /// A transaction as a spend: the shop and kind from its description and category; SmartBuy and gift-voucher
    /// payments count as SmartBuy.
    pub fn rew_tx_spend(x: &Row) -> Spend {
        let rb = rulebook();
        let d = x.t.desc.as_str();
        let shop = rb.shops.iter().find(|s| s.id != "smartbuy" && s.re.test(d));
        let tk = Self::trip_kind(d, &x.t.cat);
        let mut kind: Option<String> = match tk { "air" => Some("flights".into()), "ota" => Some("travel".into()), "other" | "grocery" => None, k => Some(k.into()) };
        if kind.is_none() { kind = shop.map(|s| s.kind.clone()); }
        if kind.is_none() {
            kind = rb.kinds.iter().find(|k| k.re.is_some() && !["shopping", "travel", "rent", "insurance", "jewellery"].contains(&k.id.as_str()) && k.re.as_ref().unwrap().test(d)).map(|k| k.id.clone());
        }
        let kind = kind.unwrap_or_else(|| match x.t.cat.as_str() { "Food & dining" => "dining", "Groceries" => "grocery", "Travel" => "travel", "Shopping" => "shopping",
            "Entertainment" => "movies", "Health" => "health", "Bills & subscriptions" => "utilities", _ => "other" }.into());
        static V: OnceLock<(Regex, Regex)> = OnceLock::new();
        let (vre, sre) = V.get_or_init(|| (re(r"gyftr|woohoo"), re(r"smart ?buy")));
        let route = if vre.is_match(d) { "voucher" } else if sre.is_match(d) { "smartbuy" } else { "card" };
        Spend { text: String::new(), amt: Some(x.t.amt), kind, shop: shop.map(|s| s.id.clone()), online: shop.is_some(), intl: false, route: route.into(), not: vec![] }
    }
    /// The points a card payment earned, the way it was paid.
    pub fn rew_tx_earn(&self, card: &RewCard, sp: &Spend, used: &HashMap<String, f64>, at: Ms) -> Option<Way> {
        let mut w = self.rew_ways(card, sp, used, at).into_iter().find(|o| o.route == "card");
        if sp.route == "smartbuy" {
            let s = Spend { kind: "flights".into(), ..sp.clone() };
            if let Some(x) = self.rew_ways(card, &s, used, at).into_iter().find(|o| o.route == "smartbuy") { w = Some(x); }
        }
        if sp.route == "voucher" {
            if let Some(r) = card.routes.iter().find(|r| r.voucher.is_some()) {
                let s = Spend { shop: Some("amazon".into()), ..sp.clone() };
                let id = format!("{}-v", r.id);
                if let Some(x) = self.rew_ways(card, &s, used, at).into_iter().find(|o| o.route == id) { w = Some(x); }
            }
        }
        w
    }
    /// How one spend earned, in words.
    pub fn rew_how(card: &RewCard, w: Option<&Way>) -> How {
        let Some(w) = w else { return How { key: "none".into(), text: "Earns nothing".into(), why: String::new() } };
        if !(w.pts > 0.0) { let n = w.notes.first().cloned().unwrap_or_default(); return How { key: format!("none:{}", n), text: "Earns nothing".into(), why: n }; }
        let rate = rew_rate_text(card, w.rate);
        if w.route != "card" { return How { key: format!("{}:{}", w.route, w.label), text: format!("{} · {}", w.label, rate), why: String::new() }; }
        if w.label == "On the card" { return How { key: "base".into(), text: format!("Everyday rate · {}", rate), why: String::new() }; }
        How { key: format!("bonus:{}", w.label), text: if w.label.chars().any(|c| c.is_ascii_digit()) { w.label.clone() } else { format!("{} · {}", w.label, rate) }, why: String::new() }
    }
    /// This month on each card you hold: the points so far, what they're worth, and the caps used.
    pub fn rew_month(&self) -> Vec<MonthCard> {
        let rb = rulebook();
        let now = self.now(); let ym = ym_of(now);
        let held = self.rew_held();
        let mut list: Vec<Row> = self.tx_for(Some(&ym), false).into_iter().filter(|x| x.t.dir == "out" && x.card.is_some() && x.t.amt > 0.0 && x.refunded.is_none()
            && !REW_SKIP.contains(&x.t.cat.as_str()) && (x.t.counted || x.for_other)).collect();
        list.sort_by_key(|x| x.t.ts);
        held.into_iter().map(|h| {
            let mut used: HashMap<String, f64> = HashMap::new();
            let mine: Vec<&Row> = list.iter().filter(|x| x.card.as_deref() == Some(h.g.as_str())).collect();
            let mut items = vec![]; let mut groups: Vec<WayGroup> = vec![];
            let (mut pts, mut spent) = (0.0, 0.0);
            if let Some(card) = h.card {
                for x in &mine {
                    let sp = Self::rew_tx_spend(x);
                    let w = self.rew_tx_earn(card, &sp, &used, x.t.ts);
                    if let Some(w) = &w { pts += w.pts; rew_use(&mut used, w, x.t.ts); }
                    spent += x.t.amt;
                    let how = Self::rew_how(card, w.as_ref());
                    let wp = w.as_ref().map(|w| w.pts).unwrap_or(0.0);
                    items.push(EarnItem { id: x.t.id.clone(), desc: x.t.desc.clone(), ts: x.t.ts, ym: x.t.ym.clone(), day: x.t.day, amt: x.t.amt, kind: sp.kind.clone(), pts: wp,
                        capped: w.as_ref().map(|w| w.capped).unwrap_or(false), how: how.text.clone(), why: how.why.clone(), for_other: x.for_other });
                    let gi = match groups.iter().position(|g| g.key == how.key) { Some(i) => i, None => { groups.push(WayGroup { key: how.key.clone(), text: how.text.clone(), why: how.why.clone(), n: 0, amt: 0.0, pts: 0.0, none: !(wp > 0.0) }); groups.len() - 1 } };
                    groups[gi].n += 1; groups[gi].amt += x.t.amt; groups[gi].pts += wp;
                }
            } else { spent = mine.iter().map(|x| x.t.amt).sum(); }
            let mut caps: Vec<CapUse> = vec![];
            if let Some(card) = h.card {
                let mut seen: HashSet<String> = HashSet::new();
                let mut look = |cp: Option<&Cap>, name: String| { let Some(cp) = cp else { return }; if !seen.insert(cp.id.clone()) { return; }
                    caps.push(CapUse { id: cp.id.clone(), name, max: cp.max, per: cp.per.clone(), on: cp.on.clone(), used: cp.max.min(used.get(&rew_key(cp, now)).copied().unwrap_or(0.0)) }); };
                for r in &card.routes {
                    look(r.cap.as_ref(), format!("{}{}", r.label, if r.cap.as_ref().map(|c| c.on == "extra").unwrap_or(false) { " bonus points" } else { "" }));
                    look(r.vcap.as_ref(), format!("{} voucher bonus points", r.label));
                }
                for b in &card.bonus { look(b.cap.as_ref(), b.label.clone()); }
                look(card.cap.as_ref(), "Everything on the card".into());
                for (k, v) in &card.kind_cap { let c = Cap { id: format!("{}-{}", card.id, k), max: v.as_f64().unwrap_or(0.0), per: "month".into(), on: "total".into() }; look(Some(&c), rb.kind(k).name.clone()); }
            }
            let mut ways = groups;
            js_sort(&mut ways, |a, b| { let d = (a.none as i32 - b.none as i32) as f64; if d != 0.0 { return d; } let p = b.pts - a.pts; if p != 0.0 { return p; } b.amt - a.amt });
            let mut full: Vec<CapUse> = caps.iter().filter(|c| c.per != "quarter" && c.max > 0.0 && c.used / c.max >= 0.8).cloned().collect();
            js_sort(&mut full, |a, b| b.used / b.max - a.used / a.max);
            items.reverse();
            MonthCard { worth: h.card.map(|c| self.rew_worth(c, pts)), g: h.g, short: h.short, card: h.card, add_on: h.add_on, pts, spent, n: mine.len(), used, caps, items, ways, full: full.into_iter().next() }
        }).collect()
    }
    pub fn rew_income(&self) -> Income { self.trip_income(&self.trip_plan()) }
    /// Every card for a spend: yours (with your caps used) and the ones you could get, best way first.
    pub fn rew_search(&self, sp: &Spend) -> Search {
        let rb = rulebook();
        let now = self.now();
        let amt = sp.amt.filter(|a| *a > 0.0).unwrap_or(REW_DEFAULT_AMT);
        let s = Spend { amt: Some(amt), ..sp.clone() };
        let month = self.rew_month(); let income = self.rew_income();
        let shops: Vec<Option<String>> = match &s.shop {
            Some(x) => vec![Some(x.clone())],
            None => std::iter::once(None).chain(rb.shops.iter().filter(|x| x.id != "smartbuy" && !s.not.contains(&x.id) && (x.sells.contains(&s.kind) || (x.kind == s.kind && x.online != Some(false)))).map(|x| Some(x.id.clone()))).collect(),
        };
        let best_of = |card: &RewCard, used: &HashMap<String, f64>| -> Vec<Way> {
            let mut all: Vec<Way> = vec![]; let mut seen: HashSet<String> = HashSet::new();
            for id in &shops {
                for mut w in self.rew_ways(card, &Spend { shop: id.clone(), ..s.clone() }, used, now) {
                    w.at = if w.free { None } else { id.clone() };
                    let k = format!("{}|{}|{}", w.route, w.label, w.at.clone().unwrap_or_else(|| "null".into()));
                    if seen.insert(k) { all.push(w); }
                }
            }
            js_sort(&mut all, |a, b| {
                let d = b.net - a.net; if d != 0.0 { return d; }
                let e = (if a.at.is_none() { 0.0 } else { 1.0 }) - (if b.at.is_none() { 0.0 } else { 1.0 }); if e != 0.0 { return e; }
                if a.route == "card" { -1.0 } else { 1.0 }
            });
            all
        };
        let net0 = |c: &SearchCard| c.best.as_ref().map(|b| b.net).unwrap_or(0.0);
        let mut yours: Vec<SearchCard> = month.iter().filter(|h| h.card.is_some()).map(|h| {
            let ways = best_of(h.card.unwrap(), &h.used);
            SearchCard { g: Some(h.g.clone()), short: h.short.clone(), card: h.card.unwrap(), add_on: h.add_on, best: ways.first().cloned(), ways, mine: true }
        }).collect();
        js_sort(&mut yours, |a, b| net0(b) - net0(a));
        let held: HashSet<&str> = month.iter().filter_map(|h| h.card.map(|c| c.id.as_str())).collect();
        let mut could: Vec<SearchCard> = rb.rew_cards.iter().filter(|c| !held.contains(c.id.as_str()) && can_get(c, &income)).map(|c| {
            let ways = best_of(c, &HashMap::new());
            SearchCard { g: None, short: c.name(), card: c, add_on: false, best: ways.first().cloned(), ways, mine: false }
        }).collect();
        js_sort(&mut could, |a, b| net0(b) - net0(a));
        let top = yours.first().filter(|y| y.best.is_some()).cloned();
        let top_net = top.as_ref().map(net0).unwrap_or(0.0);
        let better = could.iter().find(|x| x.best.as_ref().map(|b| b.net > top_net + 0.5).unwrap_or(false)).cloned();
        let runner = yours.get(1).filter(|y| y.best.is_some()).cloned();
        Search { typed_amt: sp.amt.map(|a| a > 0.0).unwrap_or(false), sp: s, yours, could, top, runner, better, unknown: month.into_iter().filter(|h| h.card.is_none()).collect(), income }
    }
    /// What the best of `cards` would have paid for spend x (straight on the card), with caps counted in `used_by`.
    fn rew_best_for(&self, cards: &[&'static RewCard], x: &Row, used_by: &mut HashMap<String, HashMap<String, f64>>) -> (f64, Option<&'static RewCard>, Spend, f64) {
        let sp = Self::rew_tx_spend(x);
        let (mut best, mut who, mut w0): (f64, Option<&'static RewCard>, Option<Way>) = (0.0, None, None);
        for c in cards {
            let used = used_by.entry(c.id.clone()).or_default();
            let w = self.rew_ways(c, &Spend { route: "card".into(), ..sp.clone() }, used, x.t.ts).into_iter().find(|o| o.route == "card");
            if let Some(w) = w { if w.worth.best > best { best = w.worth.best; who = Some(*c); w0 = Some(w); } }
        }
        if let (Some(c), Some(w)) = (who, &w0) { rew_use(used_by.get_mut(&c.id).unwrap(), w, x.t.ts); }
        (best, who, sp, w0.map(|w| w.pts).unwrap_or(0.0))
    }
    /// This month: what you earned against the best of your cards for every spend.
    pub fn rew_missed(&self) -> Missed {
        let rb = rulebook();
        let ym = ym_of(self.now());
        let held = self.rew_held();
        let cards: Vec<&'static RewCard> = held.iter().filter_map(|h| h.card).collect();
        let mut by_g: HashMap<String, Option<&'static RewCard>> = HashMap::new();
        let mut name_of: HashMap<String, String> = HashMap::new();
        for h in &held { by_g.insert(h.g.clone(), h.card); if let Some(c) = h.card { name_of.entry(c.id.clone()).or_insert_with(|| self.card_short(&h.g)); } }
        let list = spends(self.tx_for(Some(&ym), false));
        let mut used_best: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let mut used_real: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let (mut got, mut could) = (0.0, 0.0);
        let mut misses: Vec<Miss> = vec![];
        for x in &list {
            if let Some(cg) = &x.card { if !by_g.get(cg).map(|c| c.is_some()).unwrap_or(false) { continue; } }
            let (bbest, bcard, bsp, bpts) = self.rew_best_for(&cards, x, &mut used_best);
            let c = x.card.as_ref().and_then(|g| by_g.get(g).copied().flatten());
            let (mut real, mut real_pts) = (0.0, 0.0);
            if let Some(c) = c {
                let used = used_real.entry(c.id.clone()).or_default();
                if let Some(w) = self.rew_tx_earn(c, &Self::rew_tx_spend(x), used, x.t.ts) { real = w.worth.best; real_pts = w.pts; rew_use(used, &w, x.t.ts); }
            }
            got += real; could += real.max(bbest);
            if bbest - real >= 1.0 { misses.push(Miss { x: x.clone(), real, real_pts, used: c, best: bbest, best_pts: bpts, card: bcard, kind: bsp.kind.clone(), gap: bbest - real }); }
        }
        js_sort(&mut misses, |a, b| b.gap - a.gap);
        let mut tips: Vec<Tip> = vec![];
        for y in &misses {
            let card = y.card.unwrap();
            let k = format!("{}|{}", card.id, y.kind);
            let ti = match tips.iter().position(|t| format!("{}|{}", t.card.id, t.kind) == k) { Some(i) => i, None => {
                tips.push(Tip { card, short: name_of.get(&card.id).cloned().unwrap_or(card.name()), kind: y.kind.clone(), kind_name: rb.kind(&y.kind).name.clone(), n: 0, amt: 0.0, gap: 0.0, best_pts: 0.0, from: vec![], list: vec![] });
                tips.len() - 1 } };
            let t = &mut tips[ti];
            t.n += 1; t.amt += y.x.t.amt; t.gap += y.gap; t.best_pts += y.best_pts; t.list.push(y.clone());
            let f = y.used.map(|u| u.id.clone()).unwrap_or_else(|| "bank".into());
            let fi = match t.from.iter().position(|q| q.key == f) { Some(i) => i, None => {
                t.from.push(TipFrom { key: f.clone(), card: y.used, short: y.x.card.as_ref().map(|g| self.card_short(g)).unwrap_or_else(|| "bank or UPI".into()), pts: 0.0, worth: 0.0 });
                t.from.len() - 1 } };
            t.from[fi].pts += y.real_pts; t.from[fi].worth += y.real;
        }
        js_sort(&mut tips, |a, b| b.gap - a.gap);
        let n = list.len();
        Missed { got, could, gap: (could - got).max(0.0), misses: misses.into_iter().take(3).collect(), tips: tips.into_iter().take(4).collect(), n, cards: cards.len() }
    }
    /// Your next card: your last three full months of spending through your cards and each card you could get.
    pub fn rew_next(&self) -> Next {
        let rb = rulebook();
        let now = self.now(); let cur = ym_of(now);
        let held = self.rew_held();
        let mine: Vec<&'static RewCard> = held.iter().filter_map(|h| h.card).collect();
        let mut months: Vec<String> = self.months().into_iter().filter(|k| *k < cur).take(3).collect();
        let mut scale = 12.0 / (months.len().max(1) as f64); let mut basis = "months";
        if months.is_empty() {
            months = vec![cur.clone()]; basis = "month";
            let p = parts(now); let (day, dim) = (p.d, month_days(p.y, p.m));
            scale = 12.0 * if day >= 7 { dim as f64 / day as f64 } else { 1.0 };
        }
        let list = spends(months.iter().flat_map(|k| self.tx_for(Some(k), false)).collect());
        let income = self.rew_income();
        let held_ids: HashSet<&str> = mine.iter().map(|c| c.id.as_str()).collect();
        let mut used_mine: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let base: Vec<f64> = list.iter().map(|x| self.rew_best_for(&mine, x, &mut used_mine).0).collect();
        let mut rows: Vec<NextRow> = rb.rew_cards.iter().filter(|c| !held_ids.contains(c.id.as_str()) && can_get(c, &income)).map(|c| {
            let mut used: HashMap<String, f64> = HashMap::new(); let mut kinds: Vec<(String, f64)> = vec![];
            let (mut extra, mut on_it, mut pts) = (0.0, 0.0, 0.0);
            for (i, x) in list.iter().enumerate() {
                let sp = Self::rew_tx_spend(x);
                let w = self.rew_ways(c, &Spend { route: "card".into(), ..sp.clone() }, &used, x.t.ts).into_iter().find(|o| o.route == "card");
                if let Some(w) = w { if w.worth.best > base[i] {
                    extra += w.worth.best - base[i]; on_it += x.t.amt; pts += w.pts; rew_use(&mut used, &w, x.t.ts);
                    match kinds.iter_mut().find(|k| k.0 == sp.kind) { Some(k) => k.1 += w.worth.best - base[i], None => kinds.push((sp.kind.clone(), w.worth.best - base[i])) }
                } }
            }
            let (year, spend_year, pts_year) = (extra * scale, on_it * scale, pts * scale);
            let waived_by = c.waive.map(|w| w != 0.0 && spend_year >= w).unwrap_or(false);
            let fee = if waived_by { 0.0 } else { round(c.fee0() * 1.18) };
            let mut ks = kinds.clone();
            js_sort(&mut ks, |a, b| b.1 - a.1);
            let top = ks.iter().take(2).map(|k| rb.kind(&k.0).name.to_lowercase()).collect();
            NextRow { card: c, year, fee, net: year - fee, spend_year, pts_year, top, waived: waived_by && c.fee0() != 0.0 }
        }).collect();
        js_sort(&mut rows, |a, b| b.net - a.net);
        Next { rows, basis: basis.into(), n: months.len(), income, spent: list.iter().map(|x| x.t.amt).sum() }
    }
    /// Milestones and fee waivers on the cards you hold: the spend so far this quarter, and over the last 12 months.
    pub fn rew_goals(&self) -> Vec<GoalItem> {
        let now = self.now(); let p = parts(now);
        let q0 = local(p.y, (p.m / 3) * 3, 1); let y0 = now - 365 * DAY;
        let all = spends(self.tx_for(None, false));
        let mut out = vec![];
        for h in self.rew_held().into_iter().filter(|h| h.card.is_some()) {
            let card = h.card.unwrap();
            let mine: Vec<&Row> = all.iter().filter(|x| x.card.as_deref() == Some(h.g.as_str())).collect();
            let sum = |from: Ms| mine.iter().filter(|x| x.t.ts >= from).map(|x| x.t.amt).sum::<f64>();
            for m in &card.milestones {
                out.push(GoalItem { g: h.g.clone(), short: h.short.clone(), card, add_on: h.add_on, what: m.what.clone(), worth: m.worth, per: m.per.clone(), target: m.spend,
                    done: sum(if m.per == "quarter" { q0 } else { y0 }), fee: false });
            }
            if let (Some(w), true) = (card.waive.filter(|w| *w != 0.0), card.fee0() != 0.0 && !h.add_on) {
                out.push(GoalItem { g: h.g.clone(), short: h.short.clone(), card, add_on: h.add_on, what: "next year's fee waived".into(), worth: round(card.fee0() * 1.18), per: "year".into(),
                    target: w, done: sum(y0), fee: true });
            }
        }
        out
    }
    /// Everything the Rewards tab shows (the search is separate).
    pub fn rewards_model(&self) -> RewardsModel {
        RewardsModel { month: self.rew_month(), missed: self.rew_missed(), next: self.rew_next(), goals: self.rew_goals(), prefs: self.rew_prefs(), income: self.rew_income() }
    }
    /// Change a Rewards setting (prime, ai, kf); None puts it back.
    pub fn set_rew(&mut self, k: &str, v: Option<Value>) {
        let mut o = self.overrides.get("rew").and_then(|r| r.as_object()).cloned().unwrap_or_default();
        match v.filter(|v| !v.is_null() && v.as_str() != Some("")) { Some(v) => { o.insert(k.into(), v); } None => { o.remove(k); } }
        if o.is_empty() { self.overrides.remove("rew"); } else { self.overrides.insert("rew".into(), Value::Object(o)); }
        self.derive_lists(); self.resolve_payments(); self.unsaved = true;
    }
}
