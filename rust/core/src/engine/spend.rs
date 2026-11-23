//! Spending and Activity: transactions as the app lists them, money paid back, month totals (engine.js manualTx,
//! txFor, paybackOwn, spendOf, trendAll, spendModel, allTx, cycleSpend).

use super::*;
use crate::time::{local, month_days, parts, ym_add, ym_of};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CatTotal { pub name: String, pub amt: f64, pub pct: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AcctTotal { pub name: String, pub out: f64, pub n: usize }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Payee { pub name: String, pub amt: f64, pub n: usize, pub cat: String }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MonthBar { pub ym: String, pub amt: f64, pub cur: bool }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SpendOf { pub spend: f64, pub card_refunds: f64, pub paybacks: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SpendModel {
    pub ym: String, pub tx: Vec<Row>, pub spend: f64, pub card_out: f64, pub skipped: f64, pub card_refunds: f64, pub paybacks: f64,
    pub cats: Vec<CatTotal>, pub accts: Vec<AcctTotal>, pub by_day: Vec<f64>, pub last_day: i32, pub up_to: i32, pub is_cur: bool,
    pub per_day: f64, pub last_by: f64, pub this_by: f64, pub vs: Option<f64>, pub biggest: Option<Row>, pub payees: Vec<Payee>,
    pub six: Vec<MonthBar>, pub avg: Option<f64>, pub prev_ym: String,
}

/// Group totals in first-seen order (JS objects keep insertion order).
struct Ordered<V> { keys: Vec<String>, map: HashMap<String, V> }
impl<V: Default> Ordered<V> {
    fn new() -> Self { Ordered { keys: vec![], map: HashMap::new() } }
    fn entry(&mut self, k: &str) -> &mut V {
        if !self.map.contains_key(k) { self.keys.push(k.to_string()); self.map.insert(k.to_string(), V::default()); }
        self.map.get_mut(k).unwrap()
    }
}

impl Engine {
    /// Money you added by hand, as a transaction.
    pub fn manual_tx(&self, m: &Manual) -> Row {
        let card = if !m.acct.is_empty() && self.groups.contains_key(&m.acct) { Some(m.acct.clone()) } else { None };
        let bank = self.bank_by_key(&m.acct);
        let account = match (&card, bank) { (Some(c), _) => self.groups[c].short.clone(), _ if m.acct == "cash" => "Cash".into(), (_, Some(b)) => b.full.clone(), _ => "Added by you".into() };
        let dir = if m.dir == "in" { "in" } else { "out" };
        let mut x = Row::of(&Tx { id: m.id.clone(), account, kind: if card.is_some() { "card".into() } else { "bank".into() }, ts: m.ts.unwrap_or(0), day: m.d, ym: m.ym.clone(),
            amt: m.amt, dir: dir.into(), desc: m.t.clone(), cat: m.c.clone(), counted: m.dir != "in", raw: String::new(), refund_of: None, sms: false });
        x.man = true; x.card = card;
        let n = self.note_of(&m.id);
        if dir == "in" {
            if let Some(c) = n.and_then(|n| n.category.clone()) { x.t.cat = c; x.noted = true; }
            if let Some(no) = n.filter(|n| !n.note.is_empty()) { x.note = Some(no.note.clone()); }
            if x.t.cat == "Paid back" { x.paid_back = true; }
            return x;
        }
        if let Some(n) = n {
            if let Some(c) = &n.category { x.t.cat = c.clone(); x.t.counted = !not_spending(c); x.noted = true; }
            if n.for_someone_else { x.t.counted = false; x.for_other = true; x.noted = true; }
            if !n.note.is_empty() { x.note = Some(n.note.clone()); }
        }
        if x.t.counted && not_spending(&x.t.cat) { x.t.counted = false; }
        x
    }
    pub fn manual_counted(&self, m: &Manual) -> bool { self.manual_tx(m).t.counted }

    /// Transactions as the app shows them: one month ("2026-12"), or all (None). with_gone: reversed charges too.
    pub fn tx_for(&self, ym: Option<&str>, with_gone: bool) -> Vec<Row> {
        let pick = |y: &str| ym.map(|m| m == y).unwrap_or(true);
        let named = |mut x: Row| { if let Some(c) = self.card_cfg.get(&x.t.account) { x.card = Some(c.group.clone()); x.t.account = self.acct_name(&x.t.account); } x };
        let mut out: Vec<Row> = self.tx.iter().filter(|t| pick(&t.ym)).map(|t| {
            let mut x = self.with_rules(t);
            if t.out() && self.card_cfg.contains_key(&t.account) { if let Some(on) = self.rev_of(&t.id).and_then(|r| r.on) { x.refunded = Some(on); } }
            named(x)
        }).collect();
        out.extend(self.manual.iter().filter(|m| pick(&m.ym)).map(|m| self.manual_tx(m)));
        if with_gone {
            for t in &self.raw {
                if pick(&t.ym) && t.out() && self.card_cfg.contains_key(&t.account) && self.rev_of(&t.id).map(|r| r.gone).unwrap_or(false) {
                    let mut x = self.with_rules(t); x.t.counted = false; x.reversed = true; out.push(named(x));
                }
            }
        }
        out
    }
    /// Every transaction, newest first.
    pub fn all_tx(&self) -> Vec<Row> {
        let mut v = self.tx_for(None, true);
        v.sort_by(|a, b| b.t.ym.cmp(&a.t.ym).then(b.t.day.cmp(&a.t.day)).then(b.t.ts.cmp(&a.t.ts)));
        v
    }
    /// The months with anything in them, newest first (always this month).
    pub fn months(&self) -> Vec<String> {
        let mut set: std::collections::BTreeSet<String> = self.tx.iter().map(|x| x.ym.clone()).chain(self.manual.iter().map(|m| m.ym.clone())).collect();
        set.insert(ym_of(self.now()));
        set.into_iter().rev().collect()
    }
    /// Money paid back first settles what you spent for someone else; only the rest comes off your own spending.
    /// id → the part of that payback that comes off your spending.
    pub fn payback_own(&self) -> HashMap<String, f64> {
        struct E { ts: Ms, other: f64, back: f64, id: String }
        let mut list: Vec<E> = vec![];
        for t in &self.tx {
            let n = self.note_of(&t.id);
            if t.out() && n.map(|n| n.for_someone_else).unwrap_or(false) { list.push(E { ts: t.ts, other: t.amt, back: 0.0, id: String::new() }); }
            else if t.dir == "in" && self.paid_back(&t.id) { list.push(E { ts: t.ts, other: 0.0, back: t.amt, id: t.id.clone() }); }
        }
        for m in &self.manual {
            let x = self.manual_tx(m);
            if x.for_other { list.push(E { ts: self.manual_when(m), other: m.amt, back: 0.0, id: String::new() }); }
            else if x.paid_back { list.push(E { ts: self.manual_when(m), other: 0.0, back: m.amt, id: m.id.clone() }); }
        }
        list.sort_by(|a, b| a.ts.cmp(&b.ts).then(if a.other != 0.0 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }));
        let mut pool = 0.0; let mut own = HashMap::new();
        for e in list { if e.other != 0.0 { pool += e.other; } else { let take = pool.min(e.back); pool -= take; own.insert(e.id, e.back - take); } }
        own
    }
    fn own_back(own: &HashMap<String, f64>, id: &str, amt: f64) -> f64 { own.get(id).copied().unwrap_or(amt) }
    /// What counts as spending in a list: counted spends, less refunds to cards and money friends paid back.
    pub fn spend_of(&self, tx: &[Row]) -> SpendOf {
        let card_refunds: f64 = tx.iter().filter(|x| x.t.dir == "in" && x.t.kind == "card").map(|x| x.t.amt).sum();
        let back: Vec<&Row> = tx.iter().filter(|x| x.paid_back).collect();
        let own = if back.is_empty() { HashMap::new() } else { self.payback_own() };
        let paybacks: f64 = back.iter().map(|x| Self::own_back(&own, &x.t.id, x.t.amt)).sum();
        SpendOf { spend: tx.iter().filter(|x| x.t.out() && x.t.counted).map(|x| x.t.amt).sum::<f64>() - card_refunds - paybacks, card_refunds, paybacks }
    }
    /// Month by month: counted spending, less money friends paid back.
    pub fn trend_all(&self) -> BTreeMap<String, f64> {
        let mut bm: BTreeMap<String, f64> = BTreeMap::new();
        let all: Vec<Row> = self.tx.iter().map(|t| self.with_rules(t)).collect();
        let own = self.payback_own();
        for x in all.iter().filter(|x| x.t.out() && x.t.counted) { *bm.entry(x.t.ym.clone()).or_insert(0.0) += x.t.amt; }
        for m in &self.manual {
            if self.manual_counted(m) { *bm.entry(m.ym.clone()).or_insert(0.0) += m.amt; }
            else if m.dir == "in" && m.c == "Paid back" { *bm.entry(m.ym.clone()).or_insert(0.0) -= Self::own_back(&own, &m.id, m.amt); }
        }
        for x in all.iter().filter(|x| x.paid_back) { *bm.entry(x.t.ym.clone()).or_insert(0.0) -= Self::own_back(&own, &x.t.id, x.t.amt); }
        bm
    }
    pub fn spend_model(&self, ym: &str) -> SpendModel {
        let tx = self.tx_for(Some(ym), false);
        let so = self.spend_of(&tx);
        let card_out: f64 = tx.iter().filter(|x| x.t.kind == "card" && x.t.out()).map(|x| x.t.amt).sum();
        let skipped: f64 = tx.iter().filter(|x| x.t.out() && !x.t.counted).map(|x| x.t.amt).sum();
        let counted: Vec<&Row> = tx.iter().filter(|x| x.t.out() && x.t.counted).collect();
        let (yy, mm): (i32, i32) = (ym[0..4].parse().unwrap(), ym[5..7].parse().unwrap());
        let last_day = month_days(yy, mm - 1);
        let mut totals: Ordered<f64> = Ordered::new();
        for x in &counted { *totals.entry(&x.t.cat) += x.t.amt; }
        let mut cats: Vec<CatTotal> = totals.keys.iter().map(|k| CatTotal { name: k.clone(), amt: totals.map[k], pct: if so.spend > 0.0 { totals.map[k] / so.spend * 100.0 } else { 0.0 } }).collect();
        cats.sort_by(|a, b| b.amt.partial_cmp(&a.amt).unwrap());
        let mut acc: Ordered<(f64, usize)> = Ordered::new();
        for x in &tx { let e = acc.entry(&x.t.account); e.1 += 1; if x.t.out() && x.t.counted { e.0 += x.t.amt; } }
        let mut accts: Vec<AcctTotal> = acc.keys.iter().map(|k| AcctTotal { name: k.clone(), out: acc.map[k].0, n: acc.map[k].1 }).collect();
        accts.sort_by(|a, b| b.out.partial_cmp(&a.out).unwrap());
        let mut by_day = vec![0.0; last_day as usize];
        for x in &counted { if x.t.day >= 1 && x.t.day <= last_day { by_day[(x.t.day - 1) as usize] += x.t.amt; } }
        let now = self.now();
        let is_cur = ym == ym_of(now);
        let up_to = if is_cur { parts(now).d } else { last_day };
        let prev_ym = ym_add(ym, -1);
        let prev_tx = self.tx_for(Some(&prev_ym), false);
        let to_day = |list: &[Row], d: i32| { let l: Vec<Row> = list.iter().filter(|x| x.t.day <= d).cloned().collect(); self.spend_of(&l).spend };
        let last_by = to_day(&prev_tx, up_to);
        let this_by = if is_cur { to_day(&tx, up_to) } else { so.spend };
        let vs = if last_by > 0.0 { Some((this_by - last_by) / last_by * 100.0) } else { None };
        let mut big = counted.clone();
        big.sort_by(|a, b| b.t.amt.partial_cmp(&a.t.amt).unwrap());
        let biggest = big.first().map(|x| (*x).clone());
        let mut pay: Ordered<Payee> = Ordered::new();
        for x in &counted {
            let k = { let k = rule_key(&x.t.desc); if k.is_empty() { x.t.desc.clone() } else { k } };
            let p = pay.entry(&k);
            if p.n == 0 { p.name = x.t.desc.clone(); p.cat = x.t.cat.clone(); }
            p.amt += x.t.amt; p.n += 1;
        }
        let mut payees: Vec<Payee> = pay.keys.iter().map(|k| pay.map[k].clone()).collect();
        payees.sort_by(|a, b| b.amt.partial_cmp(&a.amt).unwrap());
        payees.truncate(6);
        let bm = self.trend_all();
        let six: Vec<MonthBar> = (0..6).rev().map(|i| { let k = ym_add(ym, -i); MonthBar { amt: bm.get(&k).copied().unwrap_or(0.0), cur: k == ym, ym: k } }).collect();
        let done: Vec<&MonthBar> = six.iter().filter(|s| !(is_cur && s.cur) && s.amt > 0.0).collect();
        let avg = if done.is_empty() { None } else { Some(done.iter().map(|s| s.amt).sum::<f64>() / done.len() as f64) };
        SpendModel { ym: ym.to_string(), spend: so.spend, card_out, skipped, card_refunds: so.card_refunds, paybacks: so.paybacks, cats, accts, by_day, last_day, up_to, is_cur,
            per_day: so.spend / (up_to.max(1) as f64), last_by, this_by, vs, biggest, payees, six, avg, prev_ym, tx }
    }
    /// What you've spent since payday (card spends go to the salary that pays their bill under the rule).
    pub fn cycle_spend(&self, cyc: &Cyc) -> f64 {
        let start = cyc.p0;
        let mut total = 0.0;
        let skip_cards = self.cards_paid_later(cyc);
        let own = self.payback_own();
        for t in &self.tx {
            let x = self.with_rules(t);
            if x.t.ts < start { continue; }
            if skip_cards && self.card_cfg.contains_key(&x.t.account) { continue; }
            if x.t.out() && x.t.counted { total += x.t.amt; }
            else if x.t.dir == "in" && self.card_cfg.contains_key(&x.t.account) { total -= x.t.amt; }
            else if x.t.dir == "in" && x.paid_back { total -= Self::own_back(&own, &x.t.id, x.t.amt); }
        }
        for m in &self.manual {
            let y: i32 = m.ym.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(1970);
            let mo: i32 = m.ym.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
            if local(y, mo - 1, m.d) < cyc.p0 { continue; }
            if m.dir == "in" { if m.c == "Paid back" { total -= Self::own_back(&own, &m.id, m.amt); } continue; }
            if self.manual_counted(m) && !(skip_cards && self.groups.contains_key(&m.acct)) { total += m.amt; }
        }
        total
    }
    /// "6:53 pm" for a transaction's time.
    pub fn clock_of(ts: Ms) -> String {
        if ts == 0 { return String::new(); }
        let p = parts(ts);
        let h12 = if p.h % 12 == 0 { 12 } else { p.h % 12 };
        format!("{}:{:02} {}", h12, p.mi, if p.h < 12 { "am" } else { "pm" })
    }
}
