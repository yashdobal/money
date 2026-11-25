//! Every change you can make (engine.js `act`): each one updates the figures and marks the settings unsaved, and the
//! app then saves them with `save_blob()`, the same object the app sends (pushSettings), so either app can
//! read what the other saved. Notes and payee rules also go to their own tables: those writes wait in `outbox` for
//! the app to send. The lists (manual, payments, goals, contribs) are kept as saved, so anything this version doesn't
//! know about an item is saved back untouched.
//!
//! Inputs come as the text you typed and are read the way JavaScript's parseFloat / parseInt read them.

use super::*;
use crate::time::{iso, parse_iso, ym_of};

/// A write to your edit tables that the app sends (store.js writeNow).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Write {
    Rule { pattern: String, category: String },
    Unrule { pattern: String },
    Note { r#ref: String, row: Option<Note> },
}

/// The edit sheet's choices (saveEdit).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Edit { pub category: String, pub always: bool, pub rule_was: bool, pub for_other: bool, pub paid_back: bool, pub note: String }

/// JavaScript's parseFloat: the number at the start of the text, or NaN.
pub fn parse_float(s: &str) -> f64 {
    let t = s.trim_start();
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') { i += 1; }
    if t[i..].starts_with("Infinity") { return if t.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY }; }
    let ds = i;
    while i < b.len() && b[i].is_ascii_digit() { i += 1; }
    let mut digits = i > ds;
    if i < b.len() && b[i] == b'.' {
        let k = i + 1; let mut j = k;
        while j < b.len() && b[j].is_ascii_digit() { j += 1; }
        if j > k || digits { digits = digits || j > k; i = j; }
    }
    if !digits { return f64::NAN; }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') { j += 1; }
        let k = j;
        while j < b.len() && b[j].is_ascii_digit() { j += 1; }
        if j > k { i = j; }
    }
    t[..i].parse::<f64>().unwrap_or(f64::NAN)
}
/// JavaScript's parseInt(s, 10), or None for NaN.
pub fn parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let neg = t.starts_with('-');
    let body = t.trim_start_matches(['+', '-']);
    let d: String = body.chars().take_while(|c| c.is_ascii_digit()).collect();
    if d.is_empty() || (t.len() - body.len()) > 1 { return None; }
    d.parse::<i64>().ok().map(|n| if neg { -n } else { n })
}
/// A number as JSON writes it: 1500, not 1500.0.
pub fn jnum(x: f64) -> Value {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 9.0e15 { Value::from(x as i64) } else if x.is_finite() { Value::from(x) } else { Value::Null }
}
fn opt(x: Option<f64>) -> Value { x.map(jnum).unwrap_or(Value::Null) }
fn r2(x: f64) -> f64 { crate::fmt::round(x * 100.0) / 100.0 }

impl Engine {
    /// The manual/payments/goals/contribs lists as the engine reads them, from the saved lists.
    pub(crate) fn derive_lists(&mut self) {
        self.goals = self.saved.goals.iter().map(|g| Goal { id: sv(&g["id"]), name: st(g.get("name")), start: num(g.get("start")).unwrap_or(0.0), target: num(g.get("target")).unwrap_or(0.0),
            prio: num(g.get("prio")).unwrap_or(0.0), date: st(g.get("date")) }).collect();
        self.contribs = self.saved.contribs.iter().map(|c| Contrib { id: sv(&c["id"]), goal: sv(&c["goal"]), amt: num(c.get("amt")).unwrap_or(0.0), date: st(c.get("date")) }).collect();
        self.manual = self.saved.manual.iter().map(|m| Manual { id: sv(&m["id"]), d: num(m.get("d")).unwrap_or(1.0) as i32, t: st(m.get("t")), amt: num(m.get("amt")).unwrap_or(0.0),
            c: st(m.get("c")), ym: st(m.get("ym")), dir: st(m.get("dir")), acct: st(m.get("acct")), ts: num(m.get("ts")).map(|t| t as Ms).filter(|t| *t != 0) }).collect();
        self.payments = self.saved.payments.iter().map(|p| Payment { id: sv(&p["id"]), card: st(p.get("card")), date: st(p.get("date")), amt: num(p.get("amt")).unwrap_or(0.0) }).collect();
    }
    /// After a change: the figures again, and the settings to save.
    fn changed(&mut self) { self.derive_lists(); self.resolve_payments(); self.unsaved = true; }
    fn today_iso(&self) -> String { iso(self.today()) }

    /// What pushSettings sends (the app function's "save"): your settings and every list, as saved.
    pub fn save_blob(&self) -> Value {
        let s = &self.settings;
        let mut o = Map::new();
        o.insert("ob".into(), opt(s.ob)); o.insert("obAt".into(), opt(s.ob_at)); o.insert("hob".into(), opt(s.hob)); o.insert("hobAt".into(), opt(s.hob_at));
        o.insert("inc".into(), opt(s.inc)); o.insert("payDay".into(), Value::from(s.pay_day)); o.insert("payDayV".into(), jnum(s.pay_day_v)); o.insert("buffer".into(), jnum(s.buffer));
        o.insert("joined".into(), Value::from(s.joined.clone())); o.insert("migrated".into(), Value::from(s.migrated.clone().unwrap_or_default()));
        o.insert("manual".into(), Value::Array(self.saved.manual.clone())); o.insert("payments".into(), Value::Array(self.saved.payments.clone()));
        o.insert("overrides".into(), Value::Object(self.overrides.clone()));
        o.insert("catRules".into(), Value::Object(self.cat_rules.iter().map(|(k, v)| (k.clone(), Value::from(v.clone()))).collect()));
        o.insert("goals".into(), Value::Array(self.saved.goals.clone())); o.insert("contribs".into(), Value::Array(self.saved.contribs.clone()));
        o.insert("payAssign".into(), Value::Object(self.pay_assign.clone()));
        o.insert("cfg".into(), self.cfg.clone().unwrap_or(Value::Null)); o.insert("profile".into(), self.profile.clone()); o.insert("seeded".into(), Value::Bool(true));
        Value::Object(o)
    }

    /* ---------------- the salary planner ---------------- */
    /// A planner slider: k is "sal", "family", "sip", "ef", "spend" … (whole rupees, never below zero).
    pub fn set_plan(&mut self, k: &str, v: f64) {
        let cyc = self.plan_cycle_view();
        let key = Self::plan_key(&cyc);
        let mut o = self.overrides.get(&key).and_then(|o| o.as_object()).cloned().unwrap_or_default();
        o.insert(k.into(), jnum(crate::fmt::round(v).max(0.0)));
        if k == "sal" { o.insert("salAt".into(), Value::from(self.now())); }
        self.overrides.insert(key, Value::Object(o));
        self.changed();
    }
    pub fn reset_plan(&mut self) { let k = Self::plan_key(&self.plan_cycle_view()); self.overrides.remove(&k); self.changed(); }
    /// "cur" (the salary you're living on) or "next" on the Plan screen; anything else lets it choose.
    pub fn set_plan_view(&mut self, v: &str) { self.plan_view = if v == "next" || v == "cur" { Some(v.into()) } else { None }; self.resolve_payments(); }
    /// inc (take-home), payDay, buffer or joined.
    pub fn set_setting(&mut self, k: &str, v: &str) {
        match k {
            "inc" => self.settings.inc = if v.is_empty() { None } else { let f = parse_float(v); Some(if f.is_nan() { 0.0 } else { f }) },
            "payDay" => { let n = parse_int(v).unwrap_or(0); self.settings.pay_day = if (1..=31).contains(&n) { n as i32 } else { 0 }; self.settings.pay_day_v = 1.0; }
            "buffer" => { let f = parse_float(v); self.settings.buffer = if f.is_nan() { 0.0 } else { f.max(0.0) }; }
            "joined" => self.settings.joined = if time::is_iso(v) { v.into() } else { String::new() },
            _ => return,
        }
        self.changed();
    }
    /// The balance a bank's app shows right now (k: the bank's key; your first bank when empty). "" or what's wrong.
    pub fn set_balance(&mut self, v: &str, k: &str) -> String {
        let Some(b) = self.bank_by_key(k).or(self.banks.first()) else { return "Add your bank first.".into() };
        let (name, ob, at) = (b.name.clone(), b.ob, b.at);
        let v = parse_float(v);
        if !(v >= 0.0) { return format!("Enter the balance the {} app shows right now.", name); }
        let now = self.now() as f64;
        if ob == "hob" { self.settings.hob = Some(v); } else { self.settings.ob = Some(v); }
        if at == "hobAt" { self.settings.hob_at = Some(now); } else { self.settings.ob_at = Some(now); }
        self.changed();
        String::new()
    }

    /* ---------------- goals ---------------- */
    pub fn add_goal(&mut self, name: &str, target: &str, start: &str, date: &str, prio: &str) -> String {
        let name = name.trim();
        let target = parse_float(target);
        let start = { let s = parse_float(start); if s.is_nan() { 0.0 } else { s } };
        if name.is_empty() { return "Give the goal a name.".into(); }
        if !(target > 0.0) { return "Enter a target above zero.".into(); }
        if date.is_empty() || parse_iso(date).map(|d| d <= self.today()).unwrap_or(true) { return "Pick a date in the future.".into(); }
        if start < 0.0 || start > target { return "Already saved should be between zero and the target.".into(); }
        let prio = parse_int(prio).filter(|p| *p != 0).unwrap_or(2);
        let mut g = Map::new();
        g.insert("id".into(), Value::from(format!("g{}", self.now()))); g.insert("name".into(), Value::from(name)); g.insert("target".into(), jnum(target));
        g.insert("start".into(), jnum(start)); g.insert("date".into(), Value::from(date)); g.insert("prio".into(), Value::from(prio));
        self.saved.goals.push(Value::Object(g));
        self.changed();
        String::new()
    }
    pub fn del_goal(&mut self, id: &str) {
        self.saved.goals.retain(|g| sv(&g["id"]) != id);
        self.saved.contribs.retain(|c| sv(&c["goal"]) != id);
        self.changed();
    }
    pub fn add_contrib(&mut self, goal: &str, amt: &str, date: &str) -> String {
        let amt = parse_float(amt);
        if !(amt > 0.0) { return "Enter an amount above zero.".into(); }
        if !time::is_iso(date) { return "Pick the date you moved it.".into(); }
        let mut c = Map::new();
        c.insert("id".into(), Value::from(format!("c{}", self.now()))); c.insert("goal".into(), Value::from(goal)); c.insert("amt".into(), jnum(amt)); c.insert("date".into(), Value::from(date));
        self.saved.contribs.push(Value::Object(c));
        self.changed();
        String::new()
    }
    pub fn del_contrib(&mut self, id: &str) { self.saved.contribs.retain(|c| sv(&c["id"]) != id); self.changed(); }

    /* ---------------- payments you add yourself ---------------- */
    /// dir "in" for money you received; acct: a bank's key, a card account, "cash" or "".
    pub fn add_manual(&mut self, t: &str, amt: &str, c: &str, date: &str, acct: &str, dir: &str) -> String {
        let t = t.trim();
        let amt = parse_float(amt);
        let inn = dir == "in";
        if !(amt > 0.0) { return "Enter an amount above zero.".into(); }
        if t.is_empty() { return if inn { "Add who it's from or what it's for." } else { "Add a short description." }.into(); }
        let Some(d) = parse_iso(date).filter(|_| time::is_iso(date)) else { return if inn { "Pick the day it came in." } else { "Pick the day you paid." }.into() };
        let ok = if inn { IN_PICK.iter().any(|p| p.0 == c) } else { CATS.contains(&c) };
        let mut m = Map::new();
        m.insert("id".into(), Value::from(format!("m{}", self.now()))); m.insert("d".into(), Value::from(time::date(d))); m.insert("t".into(), Value::from(t));
        m.insert("amt".into(), jnum(amt)); m.insert("c".into(), Value::from(if ok { c } else if inn { "Other income" } else { "Other" })); m.insert("ym".into(), Value::from(ym_of(d)));
        if inn { m.insert("dir".into(), Value::from("in")); }
        if !acct.is_empty() { m.insert("acct".into(), Value::from(acct)); }
        if date == self.today_iso() { m.insert("ts".into(), Value::from(self.now())); }
        self.saved.manual.push(Value::Object(m));
        self.changed();
        String::new()
    }
    pub fn edit_manual(&mut self, id: &str, t: Option<&str>, amt: Option<f64>) {
        let Some(m) = self.saved.manual.iter_mut().find(|m| sv(&m["id"]) == id) else { return };
        if let Some(t) = t.map(str::trim).filter(|t| !t.is_empty()) { m["t"] = Value::from(t); }
        if let Some(a) = amt.filter(|a| *a > 0.0) { m["amt"] = jnum(a); }
        self.changed();
    }
    pub fn del_manual(&mut self, id: &str) {
        self.saved.manual.retain(|m| sv(&m["id"]) != id);
        if self.notes.contains_key(id) { self.save_note(id, None); }
        self.changed();
    }
    /// A card charge that was reversed or refunded: before its bill closed it's dropped altogether; after, the money
    /// comes back to the card today, off the next bill. "" or what went wrong.
    pub fn reverse(&mut self, id: &str) -> String {
        let Some(t) = self.raw.iter().find(|x| x.id == id).cloned() else { return "Only a card payment can be marked as reversed.".into() };
        if t.dir != "out" || !self.card_cfg.contains_key(&t.account) { return "Only a card payment can be marked as reversed.".into(); }
        let v = if self.billed_yet(&t) { Value::from(self.today_iso()) } else { Value::Bool(true) };
        self.overrides.insert(format!("rev|{}", id), v);
        self.use_tx(true);
        self.changed();
        String::new()
    }
    /// Undo reverse() (from the charge or its refund).
    pub fn unreverse(&mut self, id: &str) {
        let id = id.strip_suffix("~refund").unwrap_or(id);
        self.overrides.remove(&format!("rev|{}", id));
        self.use_tx(true);
        self.changed();
    }

    /* ---------------- card payments ---------------- */
    pub fn assign_payment(&mut self, tx_id: &str, v: &str) { self.pay_assign.insert(tx_id.into(), Value::from(v)); self.changed(); }
    pub fn not_card_payment(&mut self, tx_id: &str) { self.assign_payment(tx_id, "none"); }
    pub fn add_payment(&mut self, group: &str, date: &str, amt: &str) -> String {
        let amt = parse_float(amt);
        if !(amt > 0.0) { return "Enter an amount above zero.".into(); }
        if !time::is_iso(date) { return "Pick the date you paid.".into(); }
        let mut p = Map::new();
        p.insert("id".into(), Value::from(format!("p{}", self.now()))); p.insert("card".into(), Value::from(group)); p.insert("date".into(), Value::from(date)); p.insert("amt".into(), jnum(amt));
        self.saved.payments.push(Value::Object(p));
        self.changed();
        String::new()
    }
    /// Undo not_card_payment / assign_payment: let the engine decide again.
    pub fn unassign_payment(&mut self, tx_id: &str) { self.pay_assign.remove(tx_id); self.changed(); }
    /// A saved figure of your own (overrides[k]): a card's limit ("limit|<group>") and the like; None removes it.
    pub fn set_override(&mut self, k: &str, v: Option<Value>) {
        match v { Some(v) => { self.overrides.insert(k.into(), v); } None => { self.overrides.remove(k); } }
        self.changed();
    }
    pub fn del_payment(&mut self, id: &str) { self.saved.payments.retain(|p| sv(&p["id"]) != id); self.changed(); }
    /// A statement's total due, typed in (okey: "<group>|<statement date>").
    pub fn set_statement(&mut self, okey: &str, amt: &str) -> String {
        let amt = parse_float(amt);
        if !(amt >= 0.0) { return "Enter the statement's total due.".into(); }
        self.overrides.insert(okey.into(), jnum(amt));
        self.changed();
        String::new()
    }
    pub fn clear_statement(&mut self, okey: &str) {
        let mut it = okey.splitn(2, '|');
        let (g, s) = (it.next().unwrap_or("").to_string(), it.next().unwrap_or("").to_string());
        self.overrides.remove(okey);
        for m in self.members_of(&g) { self.overrides.remove(&format!("{}|{}", m, s)); }
        self.changed();
    }

    /* ---------------- salary & fixed payments ---------------- */
    /// The current values in cfg form (what the editor shows and saves).
    pub fn cfg_now(&self) -> Value {
        let o = &self.offer; let r = &self.rule;
        serde_json::json!({
            "offer": { "gross": jnum(o.gross), "basic": jnum(o.basic), "pf": jnum(o.pf), "pt": jnum(o.pt), "ptFeb": opt(o.pt_feb), "allow": jnum(o.allow), "pfCap": jnum(o.pf_cap),
                       "pfCapFrom": o.pf_cap_from, "firstPayday": o.first_payday, "stipend": jnum(o.stipend), "v": jnum(o.v) },
            "rule": { "from": r.from, "savings": jnum(r.savings), "ef": jnum(r.ef), "family": jnum(r.family), "efCapX": jnum(r.ef_cap_x), "billsFrom": r.bills_from },
            "planned": self.planned.iter().map(|p| serde_json::json!({ "name": p.name, "amt": jnum(r2(p.amt)), "due": p.due, "from": p.from, "goal": p.goal_name })).collect::<Vec<_>>(),
        })
    }
    pub fn set_cfg(&mut self, next: Option<Value>) { self.apply_cfg(next); self.changed(); }
    /// "offer.gross", "rule.family" …
    pub fn set_cfg_field(&mut self, path: &str, value: Value) {
        let mut c = self.cfg_now();
        let mut it = path.splitn(2, '.');
        let (a, b) = (it.next().unwrap_or(""), it.next().unwrap_or("undefined"));
        let Some(obj) = c.get_mut(a).filter(|x| !x.is_null()) else { return };
        if let Some(o) = obj.as_object_mut() { o.insert(b.into(), value); } else { return; }
        self.set_cfg(Some(c));
    }
    /// A fixed payment (n > 1: monthly, n times from `due`). "" or what's wrong.
    pub fn add_planned(&mut self, name: &str, amt: &str, due: &str, n: &str, from: &str) -> String {
        let name = name.trim();
        let amt = parse_float(amt);
        let n = parse_int(n).filter(|n| *n != 0).unwrap_or(1).clamp(1, 60);
        if name.is_empty() { return "Say what it's for.".into(); }
        if !(amt > 0.0) { return "Enter an amount above zero.".into(); }
        let Some(d0) = parse_iso(due).filter(|_| time::is_iso(due)) else { return "Pick the first date.".into() };
        let mut c = self.cfg_now();
        let p = time::parts(d0);
        let list = c["planned"].as_array_mut().unwrap();
        for k in 0..n {
            let d = time::on_day(p.y, p.m + k as i32, p.d);
            list.push(serde_json::json!({ "name": if n > 1 { format!("{} {} of {}", name, k + 1, n) } else { name.to_string() }, "amt": jnum(amt), "due": iso(d),
                "from": if from == "savings" { "savings" } else { "pay" }, "goal": "" }));
        }
        self.set_cfg(Some(c));
        String::new()
    }
    pub fn del_planned(&mut self, i: usize) {
        let mut c = self.cfg_now();
        if let Some(l) = c["planned"].as_array_mut() { if i < l.len() { l.remove(i); } }
        self.set_cfg(Some(c));
    }
    pub fn use_take_home(&mut self) { self.settings.inc = Some(self.regular_take_home()); self.changed(); }
    pub fn reset_cfg(&mut self) { self.set_cfg(None); }
    /// Your banks and cards.
    pub fn set_profile(&mut self, p: &Value) {
        self.apply_profile(p);
        let all: Vec<Tx> = self.raw.iter().chain(self.scheduled.iter()).cloned().collect();
        self.raw = self.take_tx(all);
        self.use_tx(true);
        self.changed();
    }
    /// A setup brought in from a link or pasted text: {profile, cfg, rename}. The profile replaces yours; salary
    /// figures, rule and fixed payments only fill what you haven't set; rename moves saved planner choices kept under
    /// an older name. "" or what's wrong.
    pub fn import_setup(&mut self, x: &Value) -> String {
        let Some(p) = x.get("profile").filter(|p| p.is_object()) else { return "That isn't a Money setup.".into() };
        self.apply_profile(&p.clone());
        let all: Vec<Tx> = self.raw.iter().chain(self.scheduled.iter()).cloned().collect();
        self.raw = self.take_tx(all);
        self.use_tx(true);
        let ren: Map<String, Value> = x.get("rename").and_then(|r| r.as_object()).cloned().unwrap_or_default();
        let mv = |o: &mut Map<String, Value>| {
            for (k, to) in &ren {
                let to = sv(to);
                if let Some(v) = o.get(k).cloned() { if !o.contains_key(&to) { o.insert(to.clone(), v); } o.remove(k); }
            }
        };
        let keys: Vec<String> = self.overrides.keys().filter(|k| k.starts_with("plan|")).cloned().collect();
        for k in keys { if let Some(o) = self.overrides.get_mut(&k).and_then(|o| o.as_object_mut()) { mv(o); } }
        let mut c = self.cfg.clone().filter(|c| c.is_object()).unwrap_or(Value::Object(Map::new()));
        if let Some(r) = c.get_mut("rule").and_then(|r| r.as_object_mut()) { mv(r); }
        let add = x.get("cfg").filter(|c| c.is_object()).cloned().unwrap_or(Value::Object(Map::new()));
        for k in ["offer", "rule"] {
            if let Some(a) = add.get(k).and_then(|a| a.as_object()) {
                let mut m = a.clone();
                if let Some(mine) = c.get(k).and_then(|m| m.as_object()) { for (kk, vv) in mine { m.insert(kk.clone(), vv.clone()); } }
                c[k] = Value::Object(m);
            }
        }
        if !c.get("planned").map(|p| p.is_array()).unwrap_or(false) { if let Some(p) = add.get("planned").filter(|p| p.is_array()) { c["planned"] = p.clone(); } }
        let empty = c.as_object().map(|o| o.is_empty()).unwrap_or(true);
        self.apply_cfg(if empty { None } else { Some(c) });
        self.changed();
        String::new()
    }

    /* ---------------- your edits: payee rules and notes ---------------- */
    pub fn set_rule(&mut self, desc: &str, cat: Option<&str>) {
        let k = rule_key(desc);
        if k.is_empty() { return; }
        match cat.filter(|c| !c.is_empty()) {
            Some(c) => { self.cat_rules.insert(k.clone(), c.into()); if self.notes_ok { self.outbox.push(Write::Rule { pattern: k, category: c.into() }); } }
            None => { self.cat_rules.remove(&k); if self.notes_ok { self.outbox.push(Write::Unrule { pattern: k }); } }
        }
        self.changed();
    }
    pub fn del_rule(&mut self, pattern: &str) {
        self.cat_rules.remove(pattern);
        if self.notes_ok { self.outbox.push(Write::Unrule { pattern: pattern.into() }); }
        self.changed();
    }
    /// A note on a transaction (None or an empty one removes it).
    pub fn save_note(&mut self, id: &str, row: Option<Note>) {
        let row = row.map(|r| Note { category: r.category.filter(|c| !c.is_empty()), note: r.note.trim().to_string(), ..r });
        let empty = row.as_ref().map(|r| r.category.is_none() && !r.for_someone_else && !r.paid_back && r.note.is_empty()).unwrap_or(true);
        if empty { self.notes.remove(id); } else { self.notes.insert(id.into(), row.clone().unwrap()); }
        self.outbox.push(Write::Note { r#ref: id.into(), row: if empty { None } else { row } });
    }
    /// The edit sheet's Save. always: "Always use this for <payee>" (a payee rule); rule_was: it was ticked when the
    /// sheet opened. "" or what went wrong.
    pub fn save_edit(&mut self, id: &str, e: &Edit) -> String {
        let t = self.tx.iter().find(|x| x.id == id).cloned();
        let mi = if t.is_none() { self.saved.manual.iter().position(|m| sv(&m["id"]) == id) } else { None };
        if t.is_none() && mi.is_none() { return "That transaction isn't there any more.".into(); }
        let mut category: Option<String> = None;
        if let Some(t) = &t {
            let rule = self.rule_for(&t.desc);
            if e.always && !e.category.is_empty() { if rule.as_ref().map(|r| r.1 != e.category).unwrap_or(true) { self.set_rule(&t.desc, Some(&e.category)); } }
            else if !e.always && e.rule_was && rule.is_some() { self.set_rule(&t.desc, None); }
            // what it would be with no note of its own; a note is only kept when it says something different
            let had = self.notes.remove(id);
            let base = self.with_rules(t).t.cat;
            if let Some(h) = had { self.notes.insert(id.into(), h); }
            category = if !e.always && !e.category.is_empty() && e.category != base { Some(e.category.clone()) } else { None };
        } else if let Some(i) = mi {
            if !e.category.is_empty() && CATS.contains(&e.category.as_str()) && e.category != st(self.saved.manual[i].get("c")) { self.saved.manual[i]["c"] = Value::from(e.category.clone()); }
        }
        let inn = t.as_ref().map(|t| t.dir == "in").unwrap_or(false);
        if !self.notes_ok {
            // before the edit tables exist: only rules and "paid back" can be kept (in the saved settings)
            if inn { let k = format!("paidback|{}", id); if e.paid_back { self.overrides.insert(k, Value::Bool(true)); } else { self.overrides.remove(&k); } }
            self.changed();
            return String::new();
        }
        let row = Note { category, for_someone_else: e.for_other && t.as_ref().map(|t| t.dir == "out").unwrap_or(true), paid_back: e.paid_back && inn, note: e.note.clone() };
        if inn { let k = format!("paidback|{}", id); if row.paid_back { self.overrides.insert(k, Value::Bool(true)); } else { self.overrides.remove(&k); } }
        self.save_note(id, Some(row));
        self.changed();
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_numbers_like_javascript() {
        assert_eq!(parse_float("1,500"), 1.0);
        assert_eq!(parse_float(" 12.5k"), 12.5);
        assert_eq!(parse_float(".5"), 0.5);
        assert_eq!(parse_float("5."), 5.0);
        assert!(parse_float("abc").is_nan());
        assert!(parse_float("").is_nan());
        assert_eq!(parse_float("-3e2x"), -300.0);
        assert_eq!(parse_int("07"), Some(7));
        assert_eq!(parse_int("3.9"), Some(3));
        assert_eq!(parse_int("x"), None);
        assert_eq!(jnum(1500.0).to_string(), "1500");
        assert_eq!(jnum(12.5).to_string(), "12.5");
    }
}
