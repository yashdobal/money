//! The card rulebooks (app/trips.js TRIP_DATA, app/rewards.js REWARD_DATA and its kinds and shops), read from
//! data/cards.json, which tools/rust/data.mjs writes out of the current engine. Public information only.

use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::sync::OnceLock;

fn f(v: Option<&Value>) -> Option<f64> { v.and_then(|x| x.as_f64()) }

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Cap { pub id: String, pub max: f64, pub per: String, pub on: String }

#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Bonus {
    pub label: String, pub merchants: Option<Vec<String>>, pub kinds: Option<Vec<String>>, pub rate: f64, pub online: bool, pub except: Option<Vec<String>>,
    pub cap: Option<Cap>, pub direct: Option<Vec<String>>, pub via_ota: bool, pub min: Option<f64>, pub prime: Option<f64>, pub own: bool,
}
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Route {
    pub id: String, pub label: String, pub how: String, pub kinds: Option<Map<String, Value>>, pub merchants: Option<Map<String, Value>>,
    pub voucher: Option<f64>, pub partners: Option<f64>, pub cap: Option<Cap>, pub vcap: Option<Cap>, pub day: Option<f64>, pub note: Option<String>,
}
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Cash { pub per: f64, pub how: String }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Milestone { pub spend: f64, pub per: String, pub worth: f64, pub what: String }

/// A rewards rulebook card, with its name, fee, income, status and transfer ratios filled in from its Trips card.
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RewCard {
    pub id: String, pub trip: Option<String>, pub name: Option<String>, pub bank: Option<String>, pub unit: String, pub base: f64, pub fx: Option<f64>,
    pub fee: Option<f64>, pub waive: Option<f64>, pub income: Option<f64>, pub status: String, pub held: Option<String>,
    pub no: Vec<String>, pub no_direct: Vec<String>, pub maybe: Map<String, Value>, pub kind_cap: Map<String, Value>,
    pub bonus: Vec<Bonus>, pub routes: Vec<Route>, pub cap: Option<Cap>, pub intl: Option<f64>, pub cash: Option<Cash>,
    pub to: Option<Map<String, Value>>, pub milestones: Vec<Milestone>, pub min: Option<f64>, pub note: Option<String>, pub why: Option<String>,
}
impl RewCard {
    pub fn name(&self) -> String { self.name.clone().unwrap_or_default() }
    pub fn fee0(&self) -> f64 { self.fee.unwrap_or(0.0) }
    pub fn maybe_for(&self, kind: &str) -> Option<String> { self.maybe.get(kind).and_then(|v| v.as_str()).map(String::from) }
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Earn { pub base: f64, pub air: f64, pub ota: f64 }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Welcome { pub pts: f64, pub spend: f64, pub days: f64 }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct TripMilestone { pub at: f64, pub pts: f64, pub per: String }
/// A Trips card: what it earns, where its points move to, and what it costs.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TripCard {
    pub id: String, pub name: String, pub bank: String, pub pts: String, pub fee: f64, pub waive: Option<f64>, pub income: Option<f64>, pub status: String,
    #[serde(default)] pub held: String, pub earn: Earn, pub no: Vec<String>, #[serde(default)] pub cap: Map<String, Value>, #[serde(default)] pub welcome: Option<Welcome>,
    #[serde(default)] pub welcome_note: Option<String>, #[serde(default)] pub milestones: Vec<TripMilestone>, #[serde(default)] pub renewal: Option<f64>,
    pub to: Map<String, Value>, #[serde(default)] pub cap_a: Option<f64>, #[serde(default)] pub expire: Option<f64>, #[serde(default)] pub note: Option<String>,
    #[serde(default)] pub why: Option<String>, #[serde(default)] pub src: Vec<String>,
}
impl TripCard {
    /// This card's points for ONE partner point (ai, kf, accor), if they move there.
    pub fn to_of(&self, p: &str) -> Option<f64> { f(self.to.get(p)).filter(|r| *r != 0.0) }
}
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Award { #[serde(default)] pub y: Option<f64>, #[serde(default)] pub j: Option<f64> }
impl Award { pub fn of(&self, cab: &str) -> Option<f64> { (if cab == "j" { self.j } else { self.y }).filter(|v| *v != 0.0) } }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Country { pub id: String, pub name: String, pub city: String, #[serde(default)] pub ai: Option<Award>, #[serde(default)] pub kf: Option<Award>, pub hotel: Vec<f64>,
    #[serde(default)] pub hsrc: String, #[serde(default)] pub rough: bool }
impl Country { pub fn award(&self, p: &str) -> Option<&Award> { if p == "ai" { self.ai.as_ref() } else { self.kf.as_ref() } } }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Airline { pub name: String, pub short: String, pub unit: String, #[serde(default)] pub via: Option<String> }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Source { pub name: String, #[serde(default)] pub url: String, #[serde(default)] pub at: String }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct LeftOut { pub name: String, pub why: String }

pub struct Shop { pub id: String, pub name: String, pub re: JsRe, pub kind: String, pub sells: Vec<String>, pub voucher: bool, pub ap: bool, pub airline: bool, pub online: Option<bool> }
pub struct Kind { pub id: String, pub name: String, pub re: Option<JsRe> }

pub struct Rulebook {
    pub trips_checked: String, pub usd: f64, pub eur: f64, pub accor_per: f64, pub accor_eur: f64,
    pub air: Map<String, Value>, pub countries: Vec<Country>, pub trip_cards: Vec<TripCard>, pub trip_out: Vec<LeftOut>, pub trip_sources: Map<String, Value>,
    pub trip_re: Vec<(String, JsRe)>, pub trip_left_out: Vec<String>,
    pub rew_checked: String, pub value_ai: f64, pub value_kf: f64, pub rew_cards: Vec<RewCard>, pub rew_sources: Map<String, Value>,
    pub kinds: Vec<Kind>, pub shops: Vec<Shop>, pub online: Vec<String>, pub left_out: Vec<String>,
}
impl Rulebook {
    pub fn airline(&self, p: &str) -> Airline { serde_json::from_value(self.air.get(p).cloned().unwrap_or(Value::Null)).unwrap_or(Airline { name: p.into(), short: p.into(), unit: "points".into(), via: None }) }
    pub fn country(&self, id: &str) -> &Country { self.countries.iter().find(|c| c.id == id).unwrap_or(&self.countries[0]) }
    pub fn trip_card(&self, id: &str) -> Option<&TripCard> { self.trip_cards.iter().find(|c| c.id == id) }
    pub fn rew_card(&self, id: &str) -> Option<&RewCard> { self.rew_cards.iter().find(|c| c.id == id) }
    pub fn kind(&self, id: &str) -> &Kind { self.kinds.iter().find(|k| k.id == id).unwrap_or_else(|| self.kinds.last().unwrap()) }
    pub fn shop(&self, id: &str) -> Option<&Shop> { self.shops.iter().find(|s| s.id == id) }
    pub fn trip_re(&self, k: &str) -> &JsRe { &self.trip_re.iter().find(|x| x.0 == k).unwrap().1 }
    pub fn source(&self, k: &str) -> Option<Source> { self.trip_sources.get(k).or(self.rew_sources.get(k)).and_then(|v| serde_json::from_value(v.clone()).ok()) }
}

/// A JavaScript regular expression (case-insensitive), with its one negative lookahead (`a(?!b)c`) done by hand:
/// the regex crate has no lookarounds.
pub enum JsRe { Plain(Regex), Ahead { prefix: Regex, not: Regex, rest: Regex } }
impl JsRe {
    pub fn new(src: &str) -> JsRe {
        let ci = |s: &str| Regex::new(&format!("(?i){}", s)).unwrap();
        match src.find("(?!") {
            None => JsRe::Plain(ci(src)),
            Some(a) => {
                let mut depth = 0; let mut end = a;
                for (i, ch) in src[a..].char_indices() { match ch { '(' => depth += 1, ')' => { depth -= 1; if depth == 0 { end = a + i; break; } } _ => {} } }
                JsRe::Ahead { prefix: ci(&src[..a]), not: ci(&src[a + 3..end]), rest: ci(&src[end + 1..]) }
            }
        }
    }
    /// re.test(text)
    pub fn test(&self, text: &str) -> bool {
        match self {
            JsRe::Plain(r) => r.is_match(text),
            JsRe::Ahead { prefix, not, rest } => prefix.find_iter(text).any(|m| {
                let p = m.end();
                let at = |r: &Regex| r.find_at(text, p).map(|x| x.start() == p).unwrap_or(false);
                !at(not) && at(rest)
            }),
        }
    }
}

pub fn rulebook() -> &'static Rulebook {
    static R: OnceLock<Rulebook> = OnceLock::new();
    R.get_or_init(|| {
        let d: Value = serde_json::from_str(include_str!("../../data/cards.json")).expect("data/cards.json");
        let t = &d["trips"];
        let trip_cards: Vec<TripCard> = serde_json::from_value(t["cards"].clone()).expect("trip cards");
        // a rewards card takes its name, fee, income, status and transfer ratios from its Trips card (rewCard)
        let rew_cards: Vec<RewCard> = d["rewards"]["cards"].as_array().unwrap().iter().map(|c| {
            let tc = c.get("trip").and_then(|x| x.as_str()).and_then(|id| t["cards"].as_array().unwrap().iter().find(|x| x["id"] == id));
            let mut o = Map::new();
            let g = |k: &str| tc.and_then(|x| x.get(k)).cloned().unwrap_or(Value::Null);
            o.insert("name".into(), g("name")); o.insert("bank".into(), g("bank"));
            o.insert("fee".into(), if tc.is_some() { g("fee") } else { Value::from(0) }); o.insert("waive".into(), g("waive")); o.insert("income".into(), g("income"));
            o.insert("status".into(), if tc.is_some() { g("status") } else { Value::from("open") }); o.insert("held".into(), if tc.is_some() { g("held") } else { Value::from("") });
            o.insert("to".into(), g("to")); o.insert("why".into(), g("why"));
            for (k, v) in c.as_object().unwrap() { o.insert(k.clone(), v.clone()); }
            serde_json::from_value(Value::Object(o)).expect("rewards card")
        }).collect();
        let s = |v: &Value| v.as_str().unwrap_or("").to_string();
        let strs = |v: &Value| v.as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default();
        Rulebook {
            trips_checked: s(&t["checked"]), usd: t["fx"]["usd"].as_f64().unwrap(), eur: t["fx"]["eur"].as_f64().unwrap(),
            accor_per: t["accor"]["per"].as_f64().unwrap(), accor_eur: t["accor"]["eur"].as_f64().unwrap(),
            air: t["air"].as_object().cloned().unwrap_or_default(), countries: serde_json::from_value(t["countries"].clone()).expect("countries"),
            trip_cards, trip_out: serde_json::from_value(t["out"].clone()).unwrap_or_default(), trip_sources: t["sources"].as_object().cloned().unwrap_or_default(),
            trip_re: d["tripRe"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), JsRe::new(v.as_str().unwrap()))).collect(),
            trip_left_out: strs(&d["tripLeftOut"]),
            rew_checked: s(&d["rewards"]["checked"]), value_ai: d["rewards"]["value"]["ai"].as_f64().unwrap_or(1.0), value_kf: d["rewards"]["value"]["kf"].as_f64().unwrap_or(1.0),
            rew_cards, rew_sources: d["rewards"]["sources"].as_object().cloned().unwrap_or_default(),
            kinds: d["kinds"].as_array().unwrap().iter().map(|k| Kind { id: s(&k["id"]), name: s(&k["name"]), re: k["re"].as_str().map(JsRe::new) }).collect(),
            shops: d["shops"].as_array().unwrap().iter().map(|x| Shop { id: s(&x["id"]), name: s(&x["name"]), re: JsRe::new(x["re"].as_str().unwrap()), kind: s(&x["kind"]),
                sells: strs(&x["sells"]), voucher: x["voucher"] == true, ap: x["ap"] == true, airline: x["airline"] == true, online: x["online"].as_bool() }).collect(),
            online: strs(&d["online"]), left_out: strs(&d["leftOut"]),
        }
    })
}

/// JavaScript's Array.prototype.sort as V8 does it (TimSort: a run, then binary insertion sort, for up to 63 items),
/// so a comparator that doesn't give a strict order puts things in the same order as the current app.
pub fn js_sort<T: Clone>(v: &mut [T], cmp: impl Fn(&T, &T) -> f64) {
    let n = v.len();
    if n < 2 { return; }
    let c = |a: &T, b: &T| { let r = cmp(a, b); if r.is_nan() { 0.0 } else { r } };
    let min_run = { let mut m = n; let mut r = 0; while m >= 64 { r |= m & 1; m >>= 1; } m + r };
    let mut runs: Vec<(usize, usize)> = vec![];
    let mut low = 0;
    while low < n {
        let high = n;
        // count the run starting at low (strictly descending runs are reversed)
        let mut run = if low + 1 == high { 1 } else {
            let desc = c(&v[low + 1], &v[low]) < 0.0;
            let mut len = 2; let mut i = low + 2;
            while i < high { let o = c(&v[i], &v[i - 1]); if desc { if o >= 0.0 { break; } } else if o < 0.0 { break; } len += 1; i += 1; }
            if desc { v[low..low + len].reverse(); }
            len
        };
        if run < min_run {
            let forced = min_run.min(n - low);
            // binary insertion sort of v[low..low+forced], the first `run` already in order
            let mut start = if run == 0 { low + 1 } else { low + run };
            while start < low + forced {
                let (mut l, mut r) = (low, start);
                while l < r { let mid = l + ((r - l) >> 1); if c(&v[start], &v[mid]) < 0.0 { r = mid; } else { l = mid + 1; } }
                v[l..=start].rotate_right(1);
                start += 1;
            }
            run = forced;
        }
        runs.push((low, run));
        low += run;
    }
    // more than one run (64 items or more): merge them in turn, stably
    while runs.len() > 1 {
        let (b0, bl) = runs.pop().unwrap();
        let (a0, al) = runs.pop().unwrap();
        let left: Vec<T> = v[a0..a0 + al].to_vec();
        let right: Vec<T> = v[b0..b0 + bl].to_vec();
        let (mut i, mut j, mut k) = (0, 0, a0);
        while i < al && j < bl { if c(&right[j], &left[i]) < 0.0 { v[k] = right[j].clone(); j += 1; } else { v[k] = left[i].clone(); i += 1; } k += 1; }
        while i < al { v[k] = left[i].clone(); i += 1; k += 1; }
        while j < bl { v[k] = right[j].clone(); j += 1; k += 1; }
        runs.push((a0, al + bl));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lookahead_like_javascript() {
        let r = JsRe::new(r"\bamazon(?! ?pay ?icici)(\.in)?\b");
        assert!(r.test("Amazon.in order"));
        assert!(!r.test("AMAZON PAY ICICI"));
        assert!(r.test("amazon pay icici and amazon"));
        assert!(!r.test("amazonx"));
        let s = JsRe::new(r"\bswiggy(?! ?instamart)\b");
        assert!(s.test("Swiggy order")); assert!(!s.test("Swiggy Instamart"));
    }
    #[test]
    fn sorts_like_v8() {
        let mut v = vec![3, 1, 2, 5, 4];
        js_sort(&mut v, |a, b| (*a - *b) as f64);
        assert_eq!(v, vec![1, 2, 3, 4, 5]);
        let mut w: Vec<i32> = (0..100).rev().collect();
        js_sort(&mut w, |a, b| (*a - *b) as f64);
        assert_eq!(w, (0..100).collect::<Vec<_>>());
        let mut x: Vec<i32> = (0..150).map(|i| (i * 37) % 101).collect();
        let mut y = x.clone(); y.sort();
        js_sort(&mut x, |a, b| (*a - *b) as f64);
        assert_eq!(x, y);
        let _ = rulebook();
    }
}
