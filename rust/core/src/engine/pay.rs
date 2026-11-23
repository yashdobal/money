//! Bank balances, money moved between your own accounts, and card payments: which bank debit paid which card
//! (engine.js ownTransfers … resolvePayments, matchPlanned, withRules).

use super::*;
use crate::time::{add_days, sod};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EffPayment { pub id: String, pub group: String, pub ts: Ms, pub amt: f64, pub kind: String, pub srcs: Vec<String>, pub tx_id: Option<String>, pub debit: Option<f64>, pub saved: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PayDetail { pub confirmed: bool, pub other: Option<String>, pub srcs: Vec<String>, pub saved: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PayInfo { pub by_tx: HashMap<String, Option<String>>, pub unresolved: Vec<Tx>, pub detail: HashMap<String, PayDetail>, pub candidates: HashSet<String> }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AccountBalance { pub key: String, pub name: String, pub full: String, pub set: bool, pub bal: f64, pub ob: f64, pub since: f64, pub inn: f64, pub out: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BankBalance { pub bal: f64, pub inn: f64, pub out: f64, pub since: f64, pub parts: Vec<AccountBalance>, pub missing: Vec<String> }

/// A transaction as the app shows it: its category after your edits, and what the engine worked out about it.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct Row {
    #[serde(flatten)]
    pub t: Tx,
    pub is_pay: bool, pub pay_card: Option<String>, pub pay_confirmed: bool, pub pay_saved: f64, pub pay_other: Option<String>,
    pub paid_back: bool, pub noted: bool, pub for_other: bool, pub own: bool, pub planned: Option<String>, pub ruled: bool,
    pub note: Option<String>, pub refunded: Option<String>, pub reversed: bool, pub man: bool, pub card: Option<String>,
}
impl Row {
    pub fn of(t: &Tx) -> Row { Row { t: t.clone(), ..Default::default() } }
}

struct Conf { group: String, amt: f64, ts: Ms, srcs: Vec<String>, last4: String, tx: Option<Tx> }

pub fn pay_re() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| re_i(r"\b(credit ?card|card ?bill|cc ?(bill|pay(ment)?)|ccpay|cred( ?club)?|dreamplug|billdesk|bbps|sbi ?card|sbicard|icici ?(bank ?)?(credit ?)?card|amazon ?pay ?icici|hdfc ?(bank ?)?(credit ?)?card|hdfccard)\b").unwrap())
}
fn cred_re() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| re_i(r"\b(cred|dreamplug)").unwrap())
}
pub fn rule_key(d: &str) -> String {
    let l = d.to_lowercase();
    let first = l.split(" · ").next().unwrap_or("");
    first.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn text_of(t: &Tx) -> String { format!("{} {}", t.desc, t.raw) }

impl Engine {
    /// Money moved between your own two accounts: neither side is spending or income.
    pub fn own_transfers(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        let ins: Vec<&Tx> = self.tx.iter().filter(|t| self.is_bank(t) && t.dir == "in").collect();
        let mut outs: Vec<&Tx> = self.tx.iter().filter(|t| self.is_bank(t) && t.out()).collect();
        outs.sort_by_key(|t| t.ts);
        for t in outs {
            let from = self.bank_of(&t.account).map(|b| b.key.clone());
            let mut m: Vec<&&Tx> = ins.iter().filter(|c| !out.contains(&c.id) && self.bank_of(&c.account).map(|b| b.key.clone()) != from && (c.amt - t.amt).abs() <= 1.0
                && c.ts - t.ts >= -H && c.ts - t.ts <= 2 * D).collect();
            m.sort_by_key(|c| (c.ts - t.ts).abs());
            if let Some(c) = m.first() { out.insert(t.id.clone()); out.insert(c.id.clone()); }
        }
        out
    }
    /// Accounts a debit's text could be paying.
    pub fn groups_from_text(&self, txt: &str) -> Vec<String> {
        let by_issuer = |i: &str| self.group_order.iter().filter(|k| self.groups[*k].issuer.to_lowercase() == i.to_lowercase()).cloned().collect::<Vec<_>>();
        for x in &self.pay_text {
            if x.re.is_match(txt) {
                return match &x.groups { Some(gs) => gs.iter().filter(|g| self.groups.contains_key(*g)).cloned().collect(), None => by_issuer(&x.issuer) };
            }
        }
        if self.pay_text.is_empty() {
            let mut seen: Vec<String> = vec![];
            for k in &self.group_order { let i = &self.groups[k].issuer; if !i.is_empty() && !seen.contains(i) { seen.push(i.clone()); } }
            for i in seen {
                if re_i(&format!(r"\b{}", regex::escape(&i))).map(|r| r.is_match(txt)).unwrap_or(false) { return by_issuer(&i); }
            }
        }
        self.group_order.clone()
    }
    /// When a hand-added entry happened: the moment you added it, or noon that day.
    pub fn manual_when(&self, m: &Manual) -> Ms {
        if let Some(t) = m.ts { return t; }
        let y: i32 = m.ym.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(1970);
        let mo: i32 = m.ym.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
        crate::time::local_full(y, mo - 1, m.d, 12, 0, 0)
    }
    /// Money in or out of a bank account that you added by hand, shaped like an alert.
    pub fn manual_bank_tx(&self) -> Vec<Row> {
        self.manual.iter().filter_map(|m| {
            let b = self.bank_by_key(&m.acct)?;
            let mut r = Row::of(&Tx { id: m.id.clone(), ts: self.manual_when(m), amt: m.amt, dir: if m.dir == "in" { "in".into() } else { "out".into() },
                account: format!("{} (added by you)", b.full), desc: m.t.clone(), cat: m.c.clone(), ..Default::default() });
            r.man = true;
            Some(r)
        }).collect()
    }
    pub fn bank_tx(&self) -> Vec<Row> { self.tx.iter().map(Row::of).chain(self.manual_bank_tx()).collect() }
    /// Each account's balance: what you last typed for it, plus every alert after that moment.
    pub fn account_balance(&self, k: &str) -> AccountBalance {
        let b = self.bank_by_key(k).unwrap();
        let Some(ob) = self.settings.get(b.ob) else {
            return AccountBalance { key: b.key.clone(), name: b.name.clone(), full: b.full.clone(), ..Default::default() };
        };
        let from = self.settings.get(b.at).unwrap_or(0.0);
        let (mut inn, mut out) = (0.0, 0.0);
        for t in self.bank_tx() {
            if self.bank_of(&t.t.account).map(|x| x.key != b.key).unwrap_or(true) || (t.t.ts as f64) <= from { continue; }
            if t.t.dir == "in" { inn += t.t.amt } else { out += t.t.amt }
        }
        AccountBalance { key: b.key.clone(), name: b.name.clone(), full: b.full.clone(), set: true, bal: ob + inn - out, ob, since: from, inn, out }
    }
    pub fn bank_balance(&self) -> Option<BankBalance> {
        let parts: Vec<AccountBalance> = self.banks.iter().map(|b| self.account_balance(&b.key)).collect();
        let set: Vec<&AccountBalance> = parts.iter().filter(|p| p.set).collect();
        if set.is_empty() { return None; }
        Some(BankBalance { bal: set.iter().map(|p| p.bal).sum(), inn: set.iter().map(|p| p.inn).sum(), out: set.iter().map(|p| p.out).sum(),
            since: set.iter().map(|p| p.since).fold(f64::INFINITY, f64::min), missing: parts.iter().filter(|p| !p.set).map(|p| p.name.clone()).collect(), parts })
    }
    /// The biggest credits and debits in your bank accounts between two days.
    pub fn big_moves(&self, from: Ms, to: Ms, n: usize) -> Vec<Row> {
        let mut v: Vec<Row> = self.tx.iter().filter(|t| self.is_bank(t) && !self.self_tx.contains(&t.id) && t.ts >= from && t.ts < add_days(to, 1)).map(|t| self.with_rules(t)).collect();
        v.sort_by(|x, y| y.t.signed().abs().partial_cmp(&x.t.signed().abs()).unwrap());
        v.truncate(if n == 0 { 6 } else { n });
        v
    }

    pub fn looks_like_card_payment(&self, t: &Tx) -> bool {
        if !self.is_bank(t) || !t.out() || self.self_tx.contains(&t.id) { return false; }
        match self.pay_assign.get(&t.id) {
            Some(Value::String(a)) if a == "none" => return false,
            Some(v) if !v.is_null() && v != &Value::Bool(false) && sv(v) != "" => return true,
            _ => {}
        }
        match self.cat_rules.get(&rule_key(&t.desc)) {
            Some(r) if r == "Card payment" => return true,
            Some(r) if r != "Cash & transfers" && !r.is_empty() => return false,
            _ => {}
        }
        pay_re().is_match(&text_of(t))
    }

    /// Payment confirmations (CRED's and the bank's), each tied to the bank debit that paid it.
    fn confirmations(&self, respect_none: bool) -> Vec<Conf> {
        let mut confs: Vec<Conf> = vec![];
        let mut evs: Vec<&Event> = self.events.iter().filter(|e| e.typ == "payment").collect();
        evs.sort_by_key(|e| e.ts);
        for e in evs {
            let g = self.group_of_last4.get(&e.last4).cloned().unwrap_or_else(|| format!("other:{}", e.last4));
            if let Some(dup) = confs.iter_mut().find(|c| c.group == g && !c.srcs.contains(&e.src) && (c.amt - e.amt).abs() <= 1.0 && (c.ts - e.ts).abs() <= 3 * D) {
                dup.srcs.push(e.src.clone()); continue;
            }
            confs.push(Conf { group: g, amt: e.amt, ts: e.ts, srcs: vec![e.src.clone()], last4: e.last4.clone(), tx: None });
        }
        let mut taken: HashSet<String> = HashSet::new();
        let debits: Vec<&Tx> = self.tx.iter().filter(|t| self.is_bank(t) && t.out() && !self.self_tx.contains(&t.id)).collect();
        for c in confs.iter_mut() {
            let mut best: Option<(&Tx, i64)> = None;
            for t in &debits {
                if taken.contains(&t.id) || (respect_none && self.pay_assign.get(&t.id).and_then(|v| v.as_str()) == Some("none")) { continue; }
                let gap = c.amt - t.amt; let dt = c.ts - t.ts;
                if gap < -1.0 || gap > 25f64.max(0.02 * c.amt) { continue; }
                let billish = pay_re().is_match(&text_of(t));
                if if billish { dt < -2 * H || dt > 3 * D } else { dt.abs() > 10 * 60_000 } { continue; }
                let score = dt.abs() + if billish { 0 } else { D };
                if best.map(|b| score < b.1).unwrap_or(true) { best = Some((t, score)); }
            }
            if let Some((t, _)) = best { taken.insert(t.id.clone()); c.tx = Some(t.clone()); }
        }
        confs
    }

    /// Every card payment, strongest evidence first (resolvePayments); then goal transfers and planned payments.
    pub fn resolve_payments(&mut self) {
        self.self_tx = self.own_transfers();
        let now = self.today();
        let mut by_tx: HashMap<String, Option<String>> = HashMap::new();
        let mut by_tx_order: Vec<String> = vec![];
        let mut unresolved: Vec<Tx> = vec![];
        let mut detail: HashMap<String, PayDetail> = HashMap::new();
        self.eff_payments = vec![];

        for c in self.confirmations(true) {
            let t = c.tx.clone();
            if !self.groups.contains_key(&c.group) {
                if let Some(t) = t { by_tx.insert(t.id.clone(), None); by_tx_order.push(t.id.clone()); detail.insert(t.id.clone(), PayDetail { confirmed: true, other: Some(c.last4.clone()), srcs: c.srcs.clone(), saved: 0.0 }); }
                continue;
            }
            self.eff_payments.push(EffPayment { id: format!("conf-{}-{}", c.group, c.ts), group: c.group.clone(), ts: t.as_ref().map(|t| t.ts).unwrap_or(c.ts), amt: c.amt,
                kind: "confirmed".into(), srcs: c.srcs.clone(), tx_id: t.as_ref().map(|t| t.id.clone()), debit: t.as_ref().map(|t| t.amt),
                saved: t.as_ref().map(|t| (crate::fmt::round((c.amt - t.amt) * 100.0) / 100.0).max(0.0)).unwrap_or(0.0) });
            if let Some(t) = t { by_tx.insert(t.id.clone(), Some(c.group.clone())); by_tx_order.push(t.id.clone()); detail.insert(t.id.clone(), PayDetail { confirmed: true, other: None, srcs: c.srcs.clone(), saved: (c.amt - t.amt).max(0.0) }); }
        }

        let fits = |amt: f64, x: f64| x >= 1.0 && amt >= x * 0.97 - 10.0 && amt <= x + 10.0;
        let mut cands: Vec<Tx> = self.tx.iter().filter(|t| !by_tx.contains_key(&t.id) && self.looks_like_card_payment(t)).cloned().collect();
        cands.sort_by_key(|t| t.ts);
        for t in cands {
            let text = text_of(&t);
            let mut g = self.pay_assign.get(&t.id).map(sv).and_then(|v| self.to_group(&v));
            if g.is_none() {
                let named = self.groups_from_text(&text);
                let live: Vec<String> = named.iter().filter(|k| self.is_open(k, Some(t.ts))).cloned().collect();
                let pool = if !live.is_empty() { live } else { named };
                if pool.len() == 1 { g = Some(pool[0].clone()); } else {
                    let st: Vec<CardState> = pool.iter().map(|k| self.group_state(k, now)).collect();
                    let only = |f: &dyn Fn(&CardState) -> bool| { let m: Vec<&CardState> = st.iter().filter(|s| f(s)).collect(); if m.len() == 1 { Some(m[0].key.clone()) } else { None } };
                    g = only(&|s| fits(t.amt, s.billed_left)).or_else(|| only(&|s| fits(t.amt, s.billed)))
                        .or_else(|| only(&|s| s.min_due.map(|m| fits(t.amt, m)).unwrap_or(false))).or_else(|| only(&|s| fits(t.amt, s.owed)))
                        .or_else(|| only(&|s| s.billed_left >= 1.0));
                }
            }
            let Some(g) = g else { unresolved.push(t); continue };
            // CRED pays the whole bill for a little less; with no confirmation, assume it did
            let mut credited = t.amt;
            if cred_re().is_match(&text) {
                let s = self.group_state(&g, now);
                if s.billed_left >= 1.0 && t.amt < s.billed_left && fits(t.amt, s.billed_left) { credited = crate::fmt::round(s.billed_left * 100.0) / 100.0; }
            }
            by_tx.insert(t.id.clone(), Some(g.clone())); by_tx_order.push(t.id.clone());
            detail.insert(t.id.clone(), PayDetail { confirmed: false, other: None, srcs: vec![], saved: credited - t.amt });
            let dup = self.eff_payments.iter().any(|q| q.group == g && (q.ts - t.ts).abs() <= 3 * D && ((q.amt - t.amt).abs() <= 1.0 || (q.amt - credited).abs() <= 1.0));
            if !dup { self.eff_payments.push(EffPayment { id: format!("auto-{}", t.id), group: g, ts: t.ts, amt: credited, debit: Some(t.amt), saved: credited - t.amt, kind: "inferred".into(), tx_id: Some(t.id.clone()), srcs: vec![] }); }
        }

        // payments you typed in, unless they repeat one found above
        let mine: Vec<EffPayment> = self.payments.iter().filter_map(|p| {
            let g = self.to_group(&p.card)?;
            if p.date.is_empty() { return None; }
            Some(EffPayment { id: p.id.clone(), group: g, ts: crate::time::parse_iso_at(&p.date, 12)?, amt: p.amt, kind: "manual".into(), ..Default::default() })
        }).collect();
        let mut used: HashSet<String> = HashSet::new();
        let same = |a: f64, x: Option<f64>| x.map(|x| x != 0.0 && (a - x).abs() <= 10f64.max(0.005 * x)).unwrap_or(false);
        for q in self.eff_payments.clone() {
            let near: Vec<&EffPayment> = mine.iter().filter(|m| !used.contains(&m.id) && m.group == q.group && (m.ts - q.ts).abs() <= 3 * D).collect();
            if let Some(one) = near.iter().find(|m| (m.amt - q.amt).abs() <= 1.0 || q.debit.map(|d| d != 0.0 && (m.amt - d).abs() <= 1.0).unwrap_or(false)) { used.insert(one.id.clone()); continue; }
            let s: f64 = near.iter().map(|m| m.amt).sum();
            if near.len() > 1 && (same(s, Some(q.amt)) || same(s, q.debit)) { for m in &near { used.insert(m.id.clone()); } }
        }
        for m in mine { if !used.contains(&m.id) { self.eff_payments.push(m); } }
        let mut candidates: HashSet<String> = by_tx.keys().cloned().collect();
        candidates.extend(unresolved.iter().map(|t| t.id.clone()));
        self.pay_info = PayInfo { by_tx, unresolved, detail, candidates };

        // money you logged as moved to a goal shouldn't also count as spending
        self.contrib_tx = HashSet::new();
        for c in self.contribs.clone() {
            let Some(when) = crate::time::parse_iso_at(&c.date, 12) else { continue };
            let m = self.tx.iter().find(|t| self.is_bank(t) && t.out() && !self.self_tx.contains(&t.id) && !self.contrib_tx.contains(&t.id) && !self.pay_info.candidates.contains(&t.id)
                && (t.amt - c.amt).abs() <= 1.0 && (t.ts - when).abs() <= 3 * D).map(|t| t.id.clone());
            if let Some(id) = m { self.contrib_tx.insert(id); }
        }
        self.match_planned();
    }

    /// The transfers that pay planned items (and the family share, SIP and emergency fund) are already set aside from
    /// the salary, so they don't count as spending a second time.
    pub fn match_planned(&mut self) {
        self.planned_tx = HashMap::new();
        struct Want { name: String, amt: f64, at: Ms, lo: i64, hi: i64 }
        let mut want: Vec<Want> = self.planned.iter().filter(|p| !self.is_family_item(p)).map(|p| Want { name: p.name.clone(), amt: p.amt, at: crate::time::parse_iso(&p.due).unwrap(), lo: 7, hi: 10 }).collect();
        for c in self.plan_cycles() {
            let m = self.month_plan(&c);
            for (name, amt) in [(self.family_item(), m.family), ("SIP".to_string(), m.sip), ("Emergency fund".to_string(), m.ef)] {
                if amt >= 500.0 { want.push(Want { name, amt, at: c.p0, lo: 5, hi: 12 }); }
            }
        }
        want.sort_by_key(|w| w.at);
        for w in want {
            let tol = 50f64.max(0.02 * w.amt);
            let mut m: Vec<&Tx> = self.tx.iter().filter(|t| self.is_bank(t) && t.out() && !self.self_tx.contains(&t.id) && !self.planned_tx.contains_key(&t.id) && !self.contrib_tx.contains(&t.id)
                && !self.pay_info.candidates.contains(&t.id) && (t.amt - w.amt).abs() <= tol && t.ts >= w.at - w.lo * D && t.ts <= w.at + w.hi * D).collect();
            m.sort_by(|a, b| (a.amt - w.amt).abs().partial_cmp(&(b.amt - w.amt).abs()).unwrap());
            if let Some(t) = m.first() { let id = t.id.clone(); self.planned_tx.insert(id, w.name); }
        }
    }

    pub fn rule_for(&self, desc: &str) -> Option<(String, String)> {
        let k = rule_key(desc);
        if k.is_empty() { return None; }
        self.cat_rules.get(&k).map(|c| (k, c.clone()))
    }
    /// A transaction with your edits applied: card payments and set-aside transfers first, then a note's category, then
    /// a payee rule (withRules).
    pub fn with_rules(&self, x: &Tx) -> Row {
        let n = self.note_of(&x.id);
        let note = n.filter(|n| !n.note.is_empty()).map(|n| n.note.clone());
        let mut r = Row::of(x);
        if self.pay_info.candidates.contains(&x.id) {
            let dt = self.pay_info.detail.get(&x.id).cloned().unwrap_or_default();
            r.t.cat = "Card payment".into(); r.t.counted = false; r.is_pay = true; r.pay_card = self.pay_info.by_tx.get(&x.id).cloned().flatten();
            r.pay_confirmed = dt.confirmed; r.pay_saved = dt.saved; r.pay_other = dt.other; r.note = note; return r;
        }
        if x.dir == "in" && self.paid_back(&x.id) { r.t.cat = "Paid back".into(); r.t.counted = false; r.paid_back = true; r.note = note; return r; }
        if let Some(n) = n {
            if let Some(cat) = &n.category {
                r.t.cat = cat.clone(); r.t.counted = x.out() && !n.for_someone_else && !not_spending(cat); r.noted = true; r.for_other = x.out() && n.for_someone_else; r.note = note; return r;
            }
            if n.for_someone_else && x.out() {
                let mut b = if self.contrib_tx.contains(&x.id) || self.planned_tx.contains_key(&x.id) { Row::of(x) } else { self.with_rule_only(x) };
                b.t.counted = false; b.for_other = true; b.noted = true; b.note = note; return b;
            }
        }
        if self.self_tx.contains(&x.id) { r.t.cat = "Cash & transfers".into(); r.t.counted = false; r.own = true; r.note = note; return r; }
        if self.contrib_tx.contains(&x.id) { r.t.cat = "Moved to goals".into(); r.t.counted = false; r.note = note; return r; }
        if let Some(p) = self.planned_tx.get(&x.id) { r.t.cat = "Planned payment".into(); r.t.counted = false; r.planned = Some(p.clone()); r.note = note; return r; }
        let mut b = self.with_rule_only(x);
        b.note = note;
        b
    }
    pub fn with_rule_only(&self, x: &Tx) -> Row {
        let mut r = Row::of(x);
        if let Some(c) = self.cat_rules.get(&rule_key(&x.desc)) {
            if !c.is_empty() && *c != x.cat { r.t.cat = c.clone(); r.t.counted = x.out() && !not_spending(c); r.ruled = true; }
        }
        r
    }
    pub fn sod_now(&self) -> Ms { sod(self.now()) }
}

/// A point on the balance history: a salary in, a card bill paid, or the day you set a balance.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark { pub d: Ms, pub kind: String, pub amt: f64, pub title: String }
#[derive(Clone, Debug, PartialEq)]
pub struct History { pub pts: Vec<(Ms, f64)>, pub marks: Vec<Mark>, pub now: f64, pub set: Option<Ms>, pub parts: Vec<AccountBalance>, pub missing: Vec<String> }

impl Engine {
    /// Your bank balance at the end of each day: forwards from the balance you set with every alert since, backwards
    /// by undoing the ones before (balanceHistory).
    pub fn balance_history(&self) -> Option<History> {
        let b = self.bank_balance()?;
        let set: Vec<&AccountBalance> = b.parts.iter().filter(|p| p.set).collect();
        let since_of = |acct: &str| self.bank_of(acct).and_then(|bk| set.iter().find(|p| p.key == bk.key)).map(|p| p.since);
        let mut ax: Vec<Row> = self.bank_tx().into_iter().filter(|t| since_of(&t.t.account).is_some()).collect();
        ax.sort_by_key(|t| t.t.ts);
        let today = self.today();
        let first = ax.first().map(|t| crate::time::sod(t.t.ts)).unwrap_or(today);
        let start = first.max(crate::time::add_days(today, -400));
        let mut v: f64 = set.iter().map(|p| p.ob).sum();
        for t in &ax {
            let since = since_of(&t.t.account).unwrap();
            let ts = t.t.ts as f64;
            if ts > since && t.t.ts < start { v += t.t.signed(); } else if ts <= since && t.t.ts >= start { v -= t.t.signed(); }
        }
        let (mut pts, mut marks) = (vec![], vec![]);
        let mut i = 0;
        while i < ax.len() && ax[i].t.ts < start { i += 1; }
        let inc = self.settings.inc0();
        let mut d = start;
        while d <= today {
            let end = crate::time::add_days(d, 1);
            while i < ax.len() && ax[i].t.ts < end {
                let t = &ax[i]; i += 1;
                v += t.t.signed();
                if self.self_tx.contains(&t.t.id) { continue; }
                if t.t.dir == "in" && (t.t.cat == "Salary" || self.salary_re.is_match(&format!("{} {}", t.t.desc, t.t.raw)) || (inc != 0.0 && t.t.amt >= 0.7 * inc)) {
                    marks.push(Mark { d, kind: "salary".into(), amt: t.t.amt, title: "Salary".into() });
                } else if t.t.out() && self.with_rules(&t.t).t.cat == "Card payment" {
                    marks.push(Mark { d, kind: "card".into(), amt: -t.t.amt, title: "Card bill paid".into() });
                }
            }
            pts.push((d, v));
            d = end;
        }
        for p in &set { if p.since != 0.0 { marks.push(Mark { d: crate::time::sod(p.since as Ms), kind: "set".into(), amt: p.ob, title: format!("You set the {} balance", p.name) }); } }
        Some(History { pts, marks, now: b.bal, set: if b.since != 0.0 { Some(b.since as Ms) } else { None }, parts: b.parts.clone(), missing: b.missing.clone() })
    }
}
