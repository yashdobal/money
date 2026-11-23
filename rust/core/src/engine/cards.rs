//! Card accounts: statement cycles, what's billed and unbilled, what's paid and still owed (engine.js cycleFor,
//! statementNear, overrideFor, groupState, owedBack, allCards).

use super::*;
use crate::time::{add_days, days, iso, on_day, parse_iso, parts, sod, NEG_INF, POS_INF};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cycle { pub prev_stmt: Ms, pub stmt: Ms, pub next_stmt: Ms, pub prev_due: Ms, pub due: Ms, pub next_due: Ms }

pub fn cycle_for(cfg: &Group, now: Ms) -> Cycle {
    let p = parts(now);
    let mut stmt = on_day(p.y, p.m, cfg.stmt_day);
    if stmt > now { stmt = on_day(p.y, p.m - 1, cfg.stmt_day); }
    let s = parts(stmt);
    let prev_stmt = on_day(s.y, s.m - 1, cfg.stmt_day);
    let next_stmt = on_day(s.y, s.m + 1, cfg.stmt_day);
    Cycle { prev_stmt, stmt, next_stmt, prev_due: add_days(prev_stmt, cfg.due_after), due: add_days(stmt, cfg.due_after), next_due: add_days(next_stmt, cfg.due_after) }
}

pub fn urgency(n: i32) -> &'static str { if n <= 3 { "urgent" } else if n <= 10 { "soon" } else { "later" } }
pub fn countdown(n: i32) -> String {
    if n < 0 { return format!("{}{}", n.abs(), if n == -1 { " day overdue" } else { " days overdue" }); }
    match n { 0 => "due today".into(), 1 => "due tomorrow".into(), _ => format!("in {} days", n) }
}
fn end_of(d: Ms) -> Ms { d + DAY - 1 }

/// One card account's bill (groupState).
#[derive(Clone, Debug, PartialEq)]
pub struct CardState {
    pub key: String, pub cfg: Group, pub members: Vec<String>, pub c: Cycle, pub okey: String,
    pub billed: f64, pub billed_alerts: f64, pub source: String, pub st: Option<Event>, pub min_due: Option<f64>, pub has_override: bool,
    pub from: Ms, pub prev_unpaid: f64, pub refunds: f64, pub to_billed: f64, pub billed_left: f64, pub pre_first: bool,
    pub unbilled: f64, pub by_card: Vec<(String, f64)>, pub to_unbilled: f64, pub unbilled_left: f64, pub credit: f64, pub paid: f64,
    pub owed: f64, pub due_in: i32, pub others_billed: f64, pub others_unbilled: f64, pub others_from: Ms, pub state: &'static str,
    /// Plan: spent for someone else and coming back (set by card_bills_for's callers).
    pub back: f64,
}

/// Money spent on your cards for someone else that's still on an unpaid bill (owedBack).
#[derive(Clone, Debug, PartialEq)]
pub struct BackPart { pub card: String, pub billed: bool, pub amt: f64, pub d: Ms }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OwedBack { pub total: f64, pub parts: Vec<BackPart>, pub got: f64 }

impl Engine {
    /// The bank's own statement within 3 days of a statement date (the bank's beats CRED's copy).
    pub fn statement_near(&self, g: &str, d: Ms) -> Option<Event> {
        let stmt_date = |e: &Event| if !e.stmt.is_empty() { parse_iso(&e.stmt).unwrap_or(0) } else { sod(e.ts - DAY) };
        let mut list: Vec<&Event> = self.events.iter().filter(|e| e.typ == "statement" && self.group_of_last4.get(&e.last4).map(|x| x == g).unwrap_or(false)
            && (stmt_date(e) - sod(d)).abs() <= 3 * DAY).collect();
        list.sort_by(|a, b| ((a.src == "CRED") as i32 - (b.src == "CRED") as i32).cmp(&0).then(b.ts.cmp(&a.ts)));
        list.first().map(|e| (*e).clone())
    }
    /// A statement total you typed in (before v4 saved per card, so those add up).
    pub fn override_for(&self, g: &str, stmt: Ms) -> Option<f64> {
        let s = iso(stmt);
        if let Some(v) = self.overrides.get(&format!("{}|{}", g, s)).and_then(|v| v.as_f64()) { return Some(v); }
        let old: Vec<f64> = self.members_of(g).iter().filter_map(|m| self.overrides.get(&format!("{}|{}", m, s)).and_then(|v| v.as_f64())).collect();
        if old.is_empty() { None } else { Some(old.iter().sum()) }
    }

    pub fn group_state(&self, g: &str, now: Ms) -> CardState {
        let cfg = self.groups[g].clone();
        let mut c = cycle_for(&cfg, now);
        let members = self.members_of(g);
        let first = cfg.first_stmt.as_deref().and_then(parse_iso);
        let pre_first = first.map(|f| c.stmt < f).unwrap_or(false);
        let is_first = cfg.first_stmt.as_deref().map(|f| iso(c.stmt) == f).unwrap_or(false);
        let st = self.statement_near(g, c.stmt);
        let pst = self.statement_near(g, c.prev_stmt);
        if let Some(d) = st.as_ref().filter(|s| !s.due.is_empty()).and_then(|s| parse_iso(&s.due)) { c.due = d; }
        if let Some(d) = pst.as_ref().filter(|s| !s.due.is_empty()).and_then(|s| parse_iso(&s.due)) { c.prev_due = d; }
        let win_start = if pre_first || is_first { NEG_INF } else { end_of(c.prev_stmt) };
        let win_end = end_of(c.stmt);
        let mine = |t: &Tx| members.iter().any(|m| *m == t.account);

        let (mut billed_alerts, mut unbilled, mut refunds) = (0.0, 0.0, 0.0);
        let mut by_card: Vec<(String, f64)> = members.iter().map(|m| (m.clone(), 0.0)).collect();
        for t in &self.tx {
            if !mine(t) { continue; }
            let amt = if t.out() { t.amt } else { -t.amt };
            if !t.out() && (pre_first || t.ts > win_end) { refunds += t.amt; }
            if pre_first || t.ts > win_end {
                unbilled += amt;
                if let Some(b) = by_card.iter_mut().find(|b| b.0 == t.account) { b.1 += amt; }
            } else if t.ts > win_start { billed_alerts += amt; }
        }
        billed_alerts = billed_alerts.max(0.0);

        let ov = self.override_for(g, c.stmt);
        let source = if ov.is_some() { "you".to_string() } else if let Some(s) = &st { s.src.clone() } else { "alerts".to_string() };
        let billed = if pre_first { 0.0 } else if let Some(o) = ov { o } else if let Some(s) = &st { s.amt } else { billed_alerts };
        let spend_in = |a: Ms, b: Ms| self.tx.iter().filter(|t| mine(t) && t.ts > a && t.ts <= b).map(|t| if t.out() { t.amt } else { -t.amt }).sum::<f64>();
        let pay_in = |a: Ms, b: Ms| self.eff_payments.iter().filter(|p| p.group == g && p.ts > a && p.ts <= b).map(|p| p.amt).sum::<f64>();

        let (from, paid, prev_unpaid);
        if pre_first || (is_first && st.is_none() && ov.is_none()) { from = NEG_INF; paid = pay_in(NEG_INF, POS_INF); prev_unpaid = 0.0; }
        else if st.is_some() || ov.is_some() { from = win_end; paid = pay_in(win_end, POS_INF); prev_unpaid = 0.0; }
        else {
            from = end_of(c.prev_stmt);
            let ps = parts(c.prev_stmt);
            let pp = on_day(ps.y, ps.m - 1, cfg.stmt_day);
            let prev_first = cfg.first_stmt.as_deref().map(|f| iso(c.prev_stmt) == f).unwrap_or(false);
            let prev_bill = if let Some(p) = &pst { p.amt } else if first.map(|f| c.prev_stmt < f).unwrap_or(false) { 0.0 } else {
                (spend_in(if prev_first { NEG_INF } else { end_of(pp) }, from) - pay_in(if prev_first { NEG_INF } else { end_of(add_days(pp, cfg.due_after)) }, from)).max(0.0)
            };
            let since = pay_in(from, POS_INF);
            let mut carry = since - prev_bill;
            // alerts miss small reversals and CRED discounts, so a payment within 3% clears it
            if carry < 0.0 && since > 0.0 && -carry <= 25f64.max(0.03 * prev_bill) { carry = 0.0; }
            paid = carry.max(0.0);
            prev_unpaid = (-carry).max(0.0);
        }

        let to_billed = paid.min(billed);
        let to_unbilled = paid - to_billed;
        let off_bill = (-unbilled).max(0.0).min((billed - to_billed + prev_unpaid).max(0.0));
        let billed_left = billed - to_billed + prev_unpaid - off_bill;
        let unbilled_left = (unbilled + off_bill - to_unbilled).max(0.0);
        let credit = (to_unbilled - unbilled - off_bill).max(0.0);
        let due_in = days(now, if prev_unpaid >= 0.5 { c.prev_due } else { c.due });

        let mut others_from = POS_INF;
        let mut others_in = |a: Ms, b: Ms| {
            let mut s = 0.0;
            for t in &self.tx {
                if !mine(t) || !t.out() || !(t.ts > a && t.ts <= b) { continue; }
                if !self.note_of(&t.id).map(|n| n.for_someone_else).unwrap_or(false) { continue; }
                others_from = others_from.min(t.ts); s += t.amt;
            }
            s
        };
        let others_billed = if pre_first { 0.0 } else { (billed_left - prev_unpaid).max(0.0).min(others_in(win_start, win_end)) };
        let others_unbilled = unbilled_left.min(others_in(if pre_first { NEG_INF } else { win_end }, POS_INF));

        CardState { key: g.to_string(), okey: format!("{}|{}", g, iso(c.stmt)), cfg, members: members.clone(), c, billed, billed_alerts, source,
            min_due: st.as_ref().and_then(|s| s.min).filter(|m| *m != 0.0), st, has_override: ov.is_some(), from, prev_unpaid, refunds, to_billed, billed_left,
            pre_first, unbilled, by_card, to_unbilled, unbilled_left, credit, paid, owed: billed_left + unbilled_left, due_in,
            others_billed, others_unbilled, others_from, state: if billed_left < 0.5 { "settled" } else { urgency(due_in) }, back: 0.0 }
    }

    pub fn owed_back(&self, cards: &[CardState]) -> OwedBack {
        let mut parts = vec![];
        for c in cards {
            if c.others_billed >= 0.5 { parts.push(BackPart { card: c.key.clone(), billed: true, amt: c.others_billed, d: c.c.due }); }
            if c.others_unbilled >= 0.5 { parts.push(BackPart { card: c.key.clone(), billed: false, amt: c.others_unbilled, d: c.c.next_due }); }
        }
        if parts.is_empty() { return OwedBack::default(); }
        let from = parts.iter().map(|p| cards.iter().find(|c| c.key == p.card).map(|c| c.others_from).unwrap_or(POS_INF)).min().unwrap_or(POS_INF);
        let mut got = self.tx.iter().filter(|t| t.dir == "in" && t.ts >= from && self.paid_back(&t.id)).map(|t| t.amt).sum::<f64>()
            + self.manual.iter().filter(|m| m.dir == "in" && self.manual_tx(m).paid_back && self.manual_when(m) >= from).map(|m| m.amt).sum::<f64>();
        let had = got;
        parts.sort_by_key(|p| p.d);
        for p in parts.iter_mut() { let take = got.min(p.amt); got -= take; p.amt -= take; }
        let left: Vec<BackPart> = parts.into_iter().filter(|p| p.amt >= 0.5).collect();
        OwedBack { total: left.iter().map(|p| p.amt).sum(), parts: left, got: had - got }
    }

    pub fn all_cards(&self) -> Vec<CardState> {
        let now = self.today();
        let rank = |s: &str| match s { "urgent" => 0, "soon" => 1, "later" => 2, _ => 3 };
        let mut out: Vec<CardState> = self.open_groups(None).iter().map(|g| self.group_state(g, now)).collect();
        out.sort_by(|a, b| rank(a.state).cmp(&rank(b.state)).then(a.due_in.cmp(&b.due_in)));
        out
    }
    /// Whether a card charge is on a statement that has already closed.
    pub fn billed_yet(&self, t: &Tx) -> bool {
        let Some(c0) = self.card_cfg.get(&t.account) else { return false };
        let cfg = &self.groups[&c0.group];
        let c = cycle_for(cfg, self.now());
        if let Some(f) = cfg.first_stmt.as_deref().and_then(parse_iso) { if c.stmt < f { return false; } }
        t.ts <= c.stmt + DAY - 1
    }
    /// For the edit sheet: a card charge's mark, whether its bill has closed, and the bank's own refund for it.
    pub fn rev_info(&self, id: &str) -> Option<RevInfo> {
        let t = self.raw.iter().find(|x| x.id == id)?;
        if !t.out() { return None; }
        let g = self.card_cfg.get(&t.account)?.group.clone();
        let r = self.rev_of(id);
        let m = if r.is_some() { None } else {
            self.raw.iter().find(|x| !x.out() && self.card_cfg.get(&x.account).map(|c| c.group == g).unwrap_or(false) && x.ts > t.ts && x.ts - t.ts < 90 * DAY && (x.amt - t.amt).abs() <= 1.0).cloned()
        };
        Some(RevInfo { gone: r.as_ref().map(|r| r.gone).unwrap_or(false), on: r.and_then(|r| r.on), billed: self.billed_yet(t), matched: m })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RevInfo { pub gone: bool, pub on: Option<String>, pub billed: bool, pub matched: Option<Tx> }
