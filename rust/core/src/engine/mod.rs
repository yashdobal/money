//! The engine: every figure the app shows, worked out from the transactions, card emails and your settings
//! (app/engine.js). One `Engine` holds what engine.js keeps in its top-level variables; its methods are engine.js's
//! functions with the same names in snake_case, so the two can be read side by side.

mod cards;
mod pay;
mod plan;
mod models;
mod spend;

pub use cards::*;
pub use models::*;
pub use pay::*;
pub use plan::*;
pub use spend::*;

use crate::shape::{Data, Event, Note, Tx};
use crate::time::{self, Ms, DAY};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const CATS: [&str; 20] = ["Food & dining", "Groceries", "Travel", "Shopping", "Bills & subscriptions", "Entertainment", "Health",
    "Transfers to people", "Investments", "Cash & transfers", "Card payment", "Moved to goals",
    "Planned payment", "Money in", "Refunds", "UPI — payee unknown", "Other", "Salary", "Paid back", "Other income"];
/// Categories that are money moving, not money spent.
pub fn not_spending(c: &str) -> bool {
    matches!(c, "Investments" | "Cash & transfers" | "Card payment" | "Moved to goals" | "Planned payment" | "Money in" | "Refunds" | "Salary" | "Paid back" | "Other income")
}
pub const IN_PICK: [(&str, &str); 5] = [("Salary", "Salary"), ("Money in", "From someone"), ("Paid back", "Paid back"), ("Refunds", "Refund"), ("Other income", "Other")];

/// A billing account: cards that share one limit and one statement.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Group { pub short: String, pub sub: String, pub issuer: String, pub stmt_day: i32, pub due_after: i32, pub first_stmt: Option<String>, pub closed: Option<String>, pub catalog: String }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CardCfg { pub group: String, pub last4: String, pub short: String }
#[derive(Clone, Debug)]
pub struct Bank { pub key: String, pub name: String, pub full: String, pub re: Regex, pub ob: &'static str, pub at: &'static str }
#[derive(Clone, Debug)]
pub struct PayText { pub re: Regex, pub groups: Option<Vec<String>>, pub issuer: String }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Settings { pub ob: Option<f64>, pub ob_at: Option<f64>, pub hob: Option<f64>, pub hob_at: Option<f64>, pub inc: Option<f64>,
    pub pay_day: i32, pub pay_day_v: f64, pub buffer: f64, pub migrated: Option<String>, pub joined: String }
impl Settings {
    /// settings[b.ob] / settings[b.at]
    pub fn get(&self, k: &str) -> Option<f64> {
        match k { "ob" => self.ob, "obAt" => self.ob_at, "hob" => self.hob, "hobAt" => self.hob_at, _ => None }
    }
    pub fn inc0(&self) -> f64 { self.inc.unwrap_or(0.0) }
}

/// Money you added by hand (the alerts missed it).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Manual { pub id: String, pub d: i32, pub t: String, pub amt: f64, pub c: String, pub ym: String, pub dir: String, pub acct: String, pub ts: Option<Ms> }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Payment { pub id: String, pub card: String, pub date: String, pub amt: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Goal { pub id: String, pub name: String, pub start: f64, pub target: f64, pub prio: f64, pub date: String }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Contrib { pub id: String, pub goal: String, pub amt: f64, pub date: String }

#[derive(Clone, Debug, PartialEq)]
pub struct Offer { pub gross: f64, pub basic: f64, pub pf: f64, pub pt: f64, pub pt_feb: Option<f64>, pub allow: f64, pub pf_cap: f64, pub pf_cap_from: String, pub first_payday: String, pub stipend: f64, pub v: f64 }
impl Default for Offer {
    fn default() -> Self { Offer { gross: 0.0, basic: 0.0, pf: 0.12, pt: 0.0, pt_feb: None, allow: 0.0, pf_cap: 0.0, pf_cap_from: String::new(), first_payday: String::new(), stipend: 0.0, v: 2.0 } }
}
#[derive(Clone, Debug, PartialEq)]
pub struct SalaryRule { pub from: String, pub savings: f64, pub ef: f64, pub family: f64, pub ef_cap_x: f64, pub bills_from: String }
impl Default for SalaryRule {
    fn default() -> Self { SalaryRule { from: String::new(), savings: 0.0, ef: 0.0, family: 0.0, ef_cap_x: 6.0, bills_from: String::new() } }
}
#[derive(Clone, Debug)]
pub struct Planned { pub name: String, pub amt: f64, pub due: String, pub from: String, pub goal: Option<Regex>, pub goal_name: String }

pub(crate) fn sv(v: &Value) -> String {
    match v { Value::String(s) => s.clone(), Value::Null => String::new(), x => x.to_string() }
}
fn num(v: Option<&Value>) -> Option<f64> { v.and_then(|x| x.as_f64()).filter(|x| x.is_finite()) }
fn st(v: Option<&Value>) -> String { v.and_then(|x| x.as_str()).unwrap_or("").to_string() }
fn iso_or(v: Option<&Value>) -> Option<String> { v.and_then(|x| x.as_str()).filter(|s| time::is_iso(s)).map(String::from) }
pub fn re_i(s: &str) -> Option<Regex> { Regex::new(&format!("(?i){}", s)).ok() }

/// What the engine knows: engine.js's top-level variables.
#[derive(Clone, Debug)]
pub struct Engine {
    /// The clock: now() for figures (a fixed moment in tests).
    pub clock: Option<Ms>,
    pub profile: Value,
    pub groups: BTreeMap<String, Group>,
    /// Group keys in the profile's own order (Object.keys order).
    pub group_order: Vec<String>,
    pub card_cfg: BTreeMap<String, CardCfg>,
    pub card_order: Vec<String>,
    pub group_of_last4: HashMap<String, String>,
    pub banks: Vec<Bank>,
    pub pay_text: Vec<PayText>,
    pub salary_re: Regex,
    pub family: String,

    pub raw: Vec<Tx>,
    pub tx: Vec<Tx>,
    pub scheduled: Vec<Tx>,
    pub events: Vec<Event>,
    pub manual: Vec<Manual>,
    pub payments: Vec<Payment>,
    pub overrides: Map<String, Value>,
    pub cat_rules: BTreeMap<String, String>,
    pub goals: Vec<Goal>,
    pub contribs: Vec<Contrib>,
    pub pay_assign: Map<String, Value>,
    pub settings: Settings,
    pub cfg: Option<Value>,
    pub offer: Offer,
    pub rule: SalaryRule,
    pub planned: Vec<Planned>,
    pub notes: BTreeMap<String, Note>,
    pub notes_ok: bool,
    pub last_run: Option<Ms>,
    pub app_version: i64,
    pub data_in: bool,
    /// The Plan screen's pick: None (on its own), "cur" or "next".
    pub plan_view: Option<String>,

    // worked out by resolve_payments
    pub self_tx: HashSet<String>,
    pub eff_payments: Vec<EffPayment>,
    pub pay_info: PayInfo,
    pub contrib_tx: HashSet<String>,
    pub planned_tx: HashMap<String, String>,
}

impl Default for Engine {
    fn default() -> Self {
        Engine { clock: None, profile: Value::Object(Map::new()), groups: BTreeMap::new(), group_order: vec![], card_cfg: BTreeMap::new(), card_order: vec![],
            group_of_last4: HashMap::new(), banks: vec![], pay_text: vec![], salary_re: re_i("SALARY").unwrap(), family: String::new(),
            raw: vec![], tx: vec![], scheduled: vec![], events: vec![], manual: vec![], payments: vec![], overrides: Map::new(), cat_rules: BTreeMap::new(),
            goals: vec![], contribs: vec![], pay_assign: Map::new(), settings: Settings::default(), cfg: None, offer: Offer::default(),
            rule: SalaryRule::default(), planned: vec![], notes: BTreeMap::new(), notes_ok: false, last_run: None, app_version: 0, data_in: false,
            plan_view: None, self_tx: HashSet::new(), eff_payments: vec![], pay_info: PayInfo::default(), contrib_tx: HashSet::new(), planned_tx: HashMap::new() }
    }
}

impl Engine {
    pub fn new() -> Self { Self::default() }
    /// Now, in ms (the fixed clock when one is set).
    pub fn now(&self) -> Ms { self.clock.unwrap_or_else(|| chrono::Utc::now().timestamp_millis()) }
    pub fn today(&self) -> Ms { time::sod(self.now()) }

    /* ---------------- your banks and cards (settings.profile) ---------------- */
    pub fn apply_profile(&mut self, p: &Value) {
        self.profile = if p.is_object() { p.clone() } else { Value::Object(Map::new()) };
        self.groups.clear(); self.group_order.clear(); self.card_cfg.clear(); self.card_order.clear(); self.group_of_last4.clear();
        if let Some(gs) = self.profile.get("groups").and_then(|g| g.as_object()) {
            for (k, g) in gs {
                let sd = num(g.get("stmtDay")).unwrap_or(0.0);
                if !(sd >= 1.0 && sd <= 31.0) { continue; }
                let short = st(g.get("short"));
                self.groups.insert(k.clone(), Group { short: if short.is_empty() { k.clone() } else { short }, sub: st(g.get("sub")), issuer: st(g.get("issuer")),
                    stmt_day: sd as i32, due_after: num(g.get("dueAfter")).filter(|d| *d != 0.0).unwrap_or(20.0) as i32,
                    first_stmt: iso_or(g.get("firstStmt")), closed: iso_or(g.get("closed")), catalog: st(g.get("catalog")) });
                self.group_order.push(k.clone());
            }
        }
        if let Some(cs) = self.profile.get("cards").and_then(|c| c.as_object()) {
            for (a, c) in cs {
                let g = st(c.get("group"));
                if !self.groups.contains_key(&g) { continue; }
                let last4 = match c.get("last4") { Some(v) if !v.is_null() && sv(v) != "" => sv(v), _ => a.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect() };
                let short = st(c.get("short"));
                self.group_of_last4.insert(last4.clone(), g.clone());
                self.card_cfg.insert(a.clone(), CardCfg { group: g, short: if short.is_empty() { format!("·{}", last4) } else { short }, last4 });
                self.card_order.push(a.clone());
            }
        }
        self.banks = self.profile.get("banks").and_then(|b| b.as_array()).map(|bs| bs.iter().filter(|b| b.get("key").map(|k| !k.is_null() && sv(k) != "").unwrap_or(false))
            .take(2).enumerate().map(|(i, b)| {
                let key = sv(&b["key"]);
                let name = { let n = st(b.get("name")); if n.is_empty() { key.clone() } else { n } };
                let full = { let f = st(b.get("full")); if !f.is_empty() { f } else if !st(b.get("name")).is_empty() { st(b.get("name")) } else { key.clone() } };
                let m = { let m = st(b.get("match")); if !m.is_empty() { m } else if !st(b.get("full")).is_empty() { st(b.get("full")) } else { st(b.get("name")) } };
                Bank { key, name, full, re: re_i(&format!("^{}", regex::escape(&m))).unwrap(), ob: if i > 0 { "hob" } else { "ob" }, at: if i > 0 { "hobAt" } else { "obAt" } }
            }).collect()).unwrap_or_default();
        self.pay_text = self.profile.get("payText").and_then(|p| p.as_array()).map(|ps| ps.iter().filter_map(|x| {
            let re = re_i(x.get("re").and_then(|r| r.as_str())?)?;
            Some(PayText { re, groups: x.get("groups").and_then(|g| g.as_array()).map(|g| g.iter().map(sv).collect()), issuer: st(x.get("issuer")) })
        }).collect()).unwrap_or_default();
        let salary_text = st(self.profile.get("salaryText"));
        self.salary_re = re_i(&format!("SALARY{}", if salary_text.is_empty() { String::new() } else { format!("|{}", salary_text) })).unwrap_or_else(|| re_i("SALARY").unwrap());
        self.family = st(self.profile.get("family")).trim().to_string();
    }
    pub fn members_of(&self, g: &str) -> Vec<String> { self.card_order.iter().filter(|k| self.card_cfg[*k].group == g).cloned().collect() }
    /// A card account still in use on `d` (today when None).
    pub fn is_open(&self, g: &str, d: Option<Ms>) -> bool {
        match self.groups.get(g) {
            None => false,
            Some(gr) => match &gr.closed { None => true, Some(c) => time::iso(time::sod(d.unwrap_or_else(|| self.now()))) < *c },
        }
    }
    pub fn open_groups(&self, d: Option<Ms>) -> Vec<String> { self.group_order.iter().filter(|g| self.is_open(g, d)).cloned().collect() }
    pub fn acct_name(&self, a: &str) -> String { self.card_cfg.get(a).map(|c| self.groups[&c.group].short.clone()).unwrap_or_else(|| a.to_string()) }
    pub fn to_group(&self, v: &str) -> Option<String> {
        if self.groups.contains_key(v) { Some(v.to_string()) } else { self.card_cfg.get(v).map(|c| c.group.clone()) }
    }
    pub fn bank_by_key(&self, k: &str) -> Option<&Bank> { self.banks.iter().find(|b| b.key == k) }
    pub fn bank_of(&self, account: &str) -> Option<&Bank> { self.banks.iter().find(|b| b.re.is_match(account)) }
    pub fn is_bank(&self, t: &Tx) -> bool { self.bank_of(&t.account).is_some() }
    pub fn bank_names(&self) -> String {
        if self.banks.is_empty() { "bank".into() } else { crate::fmt::and_list(&self.banks.iter().map(|b| b.name.clone()).collect::<Vec<_>>()) }
    }
    pub fn card_group(&self, account: &str) -> Option<&str> { self.card_cfg.get(account).map(|c| c.group.as_str()) }

    /* ---------------- transactions ---------------- */
    fn take_tx(&mut self, list: Vec<Tx>) -> Vec<Tx> {
        let now = self.now();
        // a charge you scheduled on a card that's closed before its date never happens
        let all: Vec<Tx> = list.into_iter().filter(|t| !(t.id.starts_with("manual-") && self.card_cfg.get(&t.account).map(|c| !self.is_open(&c.group, Some(t.ts))).unwrap_or(false))).collect();
        let mut sch: Vec<Tx> = all.iter().filter(|t| t.ts > now).cloned().collect();
        sch.sort_by_key(|t| t.ts);
        self.scheduled = sch;
        all.into_iter().filter(|t| t.ts <= now).collect()
    }
    /// overrides["rev|<id>"]: true = reversed, "YYYY-MM-DD" = refunded that day.
    pub fn rev_of(&self, id: &str) -> Option<Rev> {
        match self.overrides.get(&format!("rev|{}", id)) {
            Some(Value::Bool(true)) => Some(Rev { gone: true, on: None }),
            Some(Value::String(s)) if time::is_iso(s) => Some(Rev { gone: false, on: Some(s.clone()) }),
            _ => None,
        }
    }
    /// TX from RAW and your reversed/refunded marks.
    pub fn use_tx(&mut self, keep: bool) {
        let mut out = Vec::with_capacity(self.raw.len());
        for t in &self.raw {
            let r = if t.out() && self.card_cfg.contains_key(&t.account) { self.rev_of(&t.id) } else { None };
            if r.as_ref().map(|r| r.gone).unwrap_or(false) { continue; }
            out.push(t.clone());
            if let Some(on) = r.and_then(|r| r.on) {
                let d = time::parse_iso(&on).unwrap();
                let mut x = t.clone();
                x.id = format!("{}~refund", t.id); x.ts = d + 12 * 3_600_000; x.day = time::date(d); x.ym = on[..7].to_string(); x.dir = "in".into();
                x.desc = format!("Refund · {}", t.desc); x.cat = "Refunds".into(); x.counted = false; x.refund_of = Some(t.id.clone());
                out.push(x);
            }
        }
        if keep { out.extend(self.tx.iter().filter(|t| t.sms).cloned()); }
        self.tx = out;
    }

    /* ---------------- settings ---------------- */
    pub fn apply_settings(&mut self, s: &Map<String, Value>) {
        self.data_in = true;
        let n = |k: &str| num(s.get(k));
        if let Some(v) = n("ob") { self.settings.ob = Some(v); }
        if let Some(v) = n("obAt") { self.settings.ob_at = Some(v); }
        if let Some(v) = n("hob") { self.settings.hob = Some(v); }
        if let Some(v) = n("hobAt") { self.settings.hob_at = Some(v); }
        if let Some(v) = n("inc") { self.settings.inc = Some(v); }
        if let Some(v) = n("payDay") { self.settings.pay_day = v as i32; }
        if let Some(v) = n("payDayV") { self.settings.pay_day_v = v; }
        if let Some(v) = n("buffer") { self.settings.buffer = v; }
        if let Some(v) = s.get("joined").and_then(|x| x.as_str()) { self.settings.joined = v.to_string(); }
        if let Some(v) = s.get("migrated").and_then(|x| x.as_str()).filter(|x| !x.is_empty()) { self.settings.migrated = Some(v.to_string()); }
        if let Some(a) = s.get("goals").and_then(|x| x.as_array()) {
            self.goals = a.iter().map(|g| Goal { id: sv(&g["id"]), name: st(g.get("name")), start: num(g.get("start")).unwrap_or(0.0), target: num(g.get("target")).unwrap_or(0.0),
                prio: num(g.get("prio")).unwrap_or(0.0), date: st(g.get("date")) }).collect();
        }
        if let Some(a) = s.get("contribs").and_then(|x| x.as_array()) {
            self.contribs = a.iter().map(|c| Contrib { id: sv(&c["id"]), goal: sv(&c["goal"]), amt: num(c.get("amt")).unwrap_or(0.0), date: st(c.get("date")) }).collect();
        }
        if let Some(o) = s.get("payAssign").and_then(|x| x.as_object()) { self.pay_assign = o.clone(); }
        if let Some(a) = s.get("manual").and_then(|x| x.as_array()) {
            self.manual = a.iter().map(|m| Manual { id: sv(&m["id"]), d: num(m.get("d")).unwrap_or(1.0) as i32, t: st(m.get("t")), amt: num(m.get("amt")).unwrap_or(0.0),
                c: st(m.get("c")), ym: st(m.get("ym")), dir: st(m.get("dir")), acct: st(m.get("acct")), ts: num(m.get("ts")).map(|t| t as Ms).filter(|t| *t != 0) }).collect();
        }
        if let Some(o) = s.get("overrides").and_then(|x| x.as_object()) { self.overrides = o.clone(); }
        if let Some(a) = s.get("payments").and_then(|x| x.as_array()) {
            self.payments = a.iter().map(|p| Payment { id: sv(&p["id"]), card: st(p.get("card")), date: st(p.get("date")), amt: num(p.get("amt")).unwrap_or(0.0) }).collect();
        }
        if let Some(o) = s.get("catRules").and_then(|x| x.as_object()) { self.cat_rules = o.iter().map(|(k, v)| (k.clone(), sv(v))).collect(); }
        if let Some(c) = s.get("cfg").filter(|c| c.is_object()) { self.apply_cfg(Some(c.clone())); }
        if let Some(p) = s.get("profile").filter(|p| p.is_object()) { self.apply_profile(&p.clone()); }
    }
    /// Your salary and fixed payments (cfg = {offer, rule, planned}).
    pub fn apply_cfg(&mut self, c: Option<Value>) {
        self.cfg = c.filter(|c| c.is_object());
        let empty = Value::Object(Map::new());
        let o = self.cfg.as_ref().and_then(|c| c.get("offer")).cloned().unwrap_or(empty.clone());
        let r = self.cfg.as_ref().and_then(|c| c.get("rule")).cloned().unwrap_or(empty);
        let d = Offer::default();
        let has_offer = self.cfg.as_ref().map(|c| c.get("offer").map(|o| !o.is_null()).unwrap_or(false)).unwrap_or(false);
        self.offer = Offer { gross: num(o.get("gross")).unwrap_or(d.gross), basic: num(o.get("basic")).unwrap_or(d.basic), pf: num(o.get("pf")).unwrap_or(d.pf),
            pt: num(o.get("pt")).unwrap_or(d.pt), pt_feb: num(o.get("ptFeb")), allow: num(o.get("allow")).unwrap_or(d.allow), pf_cap: num(o.get("pfCap")).unwrap_or(d.pf_cap),
            pf_cap_from: iso_or(o.get("pfCapFrom")).unwrap_or_default(), first_payday: iso_or(o.get("firstPayday")).unwrap_or_default(),
            stipend: num(o.get("stipend")).unwrap_or(d.stipend), v: num(o.get("v")).unwrap_or(if has_offer { 1.0 } else { d.v }) };
        let dr = SalaryRule::default();
        self.rule = SalaryRule { from: iso_or(r.get("from")).unwrap_or_default(), savings: num(r.get("savings")).unwrap_or(dr.savings), ef: num(r.get("ef")).unwrap_or(dr.ef),
            family: num(r.get("family")).unwrap_or(dr.family), ef_cap_x: num(r.get("efCapX")).unwrap_or(dr.ef_cap_x), bills_from: iso_or(r.get("billsFrom")).unwrap_or_default() };
        let mut planned: Vec<Planned> = self.cfg.as_ref().and_then(|c| c.get("planned")).and_then(|p| p.as_array()).map(|ps| ps.iter().filter(|p| {
            p.get("name").map(|n| !n.is_null() && sv(n) != "").unwrap_or(false) && num(p.get("amt")).map(|a| a > 0.0).unwrap_or(false) && iso_or(p.get("due")).is_some()
        }).map(|p| {
            let goal = st(p.get("goal"));
            Planned { name: sv(&p["name"]), amt: num(p.get("amt")).unwrap(), due: st(p.get("due")), from: if st(p.get("from")) == "savings" { "savings".into() } else { "pay".into() },
                goal: if goal.is_empty() { None } else { re_i(&regex::escape(&goal)) }, goal_name: goal }
        }).collect()).unwrap_or_default();
        planned.sort_by(|a, b| a.due.cmp(&b.due));
        self.planned = planned;
    }
    pub fn apply_notes(&mut self, data: &Data) {
        self.notes_ok = data.notes_ok;
        if !self.notes_ok { return; }
        self.notes = data.notes.clone();
        self.cat_rules = data.payee_rules.clone();
    }
    pub fn note_of(&self, id: &str) -> Option<&Note> { self.notes.get(id) }
    /// A friend paying you back: a note's tick, or (before the notes table) overrides["paidback|<id>"].
    pub fn paid_back(&self, id: &str) -> bool {
        if self.notes_ok { self.notes.get(id).map(|n| n.paid_back).unwrap_or(false) } else { self.overrides.get(&format!("paidback|{}", id)) == Some(&Value::Bool(true)) }
    }

    /// Takes in what getData() returned (ingest). Returns whether the settings need saving.
    pub fn ingest(&mut self, data: &Data) -> bool {
        if let Some(p) = data.settings.get("profile").filter(|p| p.is_object()) { self.apply_profile(&p.clone()); }
        self.raw = self.take_tx(data.tx.clone());
        let mut seen = HashSet::new();
        self.events = data.events.iter().filter(|e| !e.id.is_empty() && seen.insert(e.id.clone())).cloned().collect();
        self.last_run = data.last_run;
        self.app_version = data.app_version;
        self.apply_settings(&data.settings);
        self.use_tx(false);
        self.apply_notes(data);
        self.resolve_payments();
        !data.settings.get("seeded").map(|v| v.as_bool().unwrap_or(false) || v.as_f64().map(|n| n != 0.0).unwrap_or(false)).unwrap_or(false)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rev { pub gone: bool, pub on: Option<String> }

pub(crate) fn sum<T>(list: &[T], f: impl Fn(&T) -> f64) -> f64 { list.iter().map(f).sum() }
pub(crate) const H: Ms = 3_600_000;
pub(crate) const D: Ms = DAY;

impl PartialEq for Planned {
    fn eq(&self, o: &Self) -> bool { self.name == o.name && self.amt == o.amt && self.due == o.due && self.from == o.from && self.goal_name == o.goal_name }
}
