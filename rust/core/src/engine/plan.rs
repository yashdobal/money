//! The salary planner: pay cycles, the salary (expected or credited), your rule's split, card bills a salary pays,
//! fixed payments and goals (engine.js payOn … goalPlan, stillToSetAside).

use super::*;
use crate::time::{add_days, days, iso, local, month_days, on_day, parse_iso, parse_iso_at, parts, sod};

/// A pay cycle: payday p0 up to (not including) the next payday p1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cyc { pub p0: Ms, pub p1: Ms, pub upcoming: bool, pub ahead: bool, pub days_left: i32, pub cycle_days: i32, pub day_of: i32 }
impl Cyc { pub fn new(p0: Ms, p1: Ms) -> Cyc { Cyc { p0, p1, upcoming: false, ahead: false, days_left: 0, cycle_days: 0, day_of: 0 } } }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Expected { pub amt: f64, pub stipend: bool, pub partial: bool, pub join: Option<Ms>, pub worked: i32, pub dim: i32, pub assumed: bool }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Salary { pub amt: f64, pub credited: Option<Ms>, pub bank: Option<String>, pub in_balance: bool, pub exp: Expected }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Split { pub amt: f64, pub savings: f64, pub ef: f64, pub family: f64, pub spend: f64, pub cap: f64, pub ef_saved: f64, pub ef_full: bool,
    pub ef_rule: f64, pub ef_take: f64, pub sav_take: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CardBill { pub key: String, pub name: String, pub total: f64, pub left: f64, pub due: Ms, pub stmt: Ms, pub billed: bool, pub back: f64, pub amt: f64, pub paid: bool }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlanDef { pub sal: f64, pub family: f64, pub sip: f64, pub ef: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct MonthPlan { pub cyc: Cyc, pub rule: bool, pub sal: Salary, pub amt: f64, pub def: PlanDef, pub family: f64, pub sip: f64, pub ef: f64,
    pub fixed: Vec<Planned>, pub fixed_total: f64, pub cards: Vec<CardBill>, pub cards_total: f64, pub spend: f64, pub split: Option<Split>, pub edited: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct GoalRow { pub g: Goal, pub saved: f64, pub moved_now: f64, pub need: f64, pub months_left: i32, pub done: bool, pub due: Option<Ms>, pub pct: f64,
    pub by_rule: bool, pub emis: Vec<Planned>, pub next_emi: Option<Planned>, pub funded: f64, pub short: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct SetAside { pub name: String, pub kind: String, pub left: f64 }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Usual { pub amt: f64, pub family: f64, pub sip: f64, pub ef: f64, pub spend: f64, pub ef_full: bool }

impl Engine {
    /// Payday in a month: payDay 0 = the last working day, otherwise that day (31 = the last day).
    pub fn pay_on(&self, y: i32, m: i32) -> Ms {
        let day = self.settings.pay_day;
        if day > 0 { return on_day(y, m, day); }
        let mut d = on_day(y, m, 31);
        while matches!(crate::time::dow(d), 0 | 6) { d = add_days(d, -1); }
        d
    }
    pub fn next_cycle(&self, c: &Cyc) -> Cyc { let p = parts(c.p1); Cyc::new(c.p1, self.pay_on(p.y, p.m + 1)) }
    /// The pay cycle a date falls in.
    pub fn cycle_at(&self, d: Ms) -> Cyc {
        let t = sod(d); let p = parts(t);
        let mut p1 = self.pay_on(p.y, p.m);
        if p1 <= t { p1 = self.pay_on(p.y, p.m + 1); }
        let q = parts(p1);
        Cyc::new(self.pay_on(q.y, q.m - 1), p1)
    }
    /// Payday to payday; on payday itself a new cycle starts.
    pub fn pay_cycle(&self) -> Cyc {
        let now = self.today(); let p = parts(now);
        let mut p1 = self.pay_on(p.y, p.m);
        if p1 <= now { p1 = self.pay_on(p.y, p.m + 1); }
        let q = parts(p1);
        let p0 = self.pay_on(q.y, q.m - 1);
        Cyc { p0, p1, upcoming: false, ahead: false, days_left: days(now, p1).max(1), cycle_days: days(p0, p1).max(1), day_of: days(p0, now) }
    }
    /// Your first salary's date (a year ago when it isn't set).
    pub fn first_payday(&self) -> Ms {
        if let Some(d) = parse_iso(&self.offer.first_payday) { return d; }
        let t = parts(self.today());
        local(t.y - 1, t.m, t.d.min(28))
    }
    /// Pay cycles from the one before your first salary up to one starting within 5 days.
    pub fn plan_cycles(&self) -> Vec<Cyc> {
        let soon = self.now() + 5 * D;
        let mut out = vec![];
        let mut c = self.cycle_at(self.first_payday() - 3 * D);
        let mut i = 0;
        while i < 60 && c.p0 <= soon { out.push(c); c = self.next_cycle(&c); i += 1; }
        out
    }
    pub fn goal_saved_before(&self, g: &Goal, when: Ms) -> f64 {
        g.start + self.contribs.iter().filter(|c| c.goal == g.id && parse_iso_at(&c.date, 12).map(|t| t < when).unwrap_or(false)).map(|c| c.amt).sum::<f64>()
    }
    pub fn pf_on(&self, d: Option<Ms>) -> f64 {
        let full = self.offer.pf * self.offer.basic;
        match d { Some(d) if !self.offer.pf_cap_from.is_empty() && iso(d) >= self.offer.pf_cap_from => full.min(self.offer.pf_cap), _ => full }
    }
    pub fn pt_on(&self, d: Option<Ms>) -> f64 {
        match (d, self.offer.pt_feb) { (Some(d), Some(f)) if parts(d).m == 1 => f, _ => self.offer.pt }
    }
    pub fn take_home_on(&self, d: Ms) -> f64 { crate::fmt::round(self.offer.gross + self.offer.allow - self.pf_on(Some(d)) - self.pt_on(Some(d))) }
    pub fn regular_take_home(&self) -> f64 {
        let now = self.today();
        let d = parse_iso(&self.offer.pf_cap_from).filter(|f| *f > now).unwrap_or(now);
        crate::fmt::round(self.offer.gross + self.offer.allow - self.pf_on(Some(d)) - self.offer.pt)
    }
    pub fn auto_inc(&self) -> bool { self.settings.inc == Some(self.regular_take_home()) }

    /// What a cycle's payday should bring, before the credit shows up.
    pub fn expected_for(&self, cyc: &Cyc) -> Expected {
        let first = self.first_payday();
        let gap = days(first, cyc.p0);
        if gap < -5 { return Expected { amt: self.offer.stipend, stipend: true, ..Default::default() }; }
        if gap > 5 { return Expected { amt: if self.auto_inc() { self.take_home_on(cyc.p0) } else { self.settings.inc0() }, ..Default::default() }; }
        let f = parts(first);
        let m_start = local(f.y, f.m, 1);
        let dim = month_days(f.y, f.m);
        let m_end = local(f.y, f.m, dim);
        let tomorrow = self.today() + D;
        let joined = if time::is_iso(&self.settings.joined) { parse_iso(&self.settings.joined) } else { None };
        let join = joined.unwrap_or(tomorrow.max(m_start));
        let before = if join <= m_start { 0 } else if join > m_end { dim } else { parts(join).d - 1 };
        let worked = (dim - before).min(dim).max(0);
        let fr = worked as f64 / dim as f64;
        let amt = if worked > 0 { crate::fmt::round((self.offer.gross - self.pf_on(Some(cyc.p0))) * fr + self.offer.allow - self.pt_on(Some(cyc.p0))) } else { 0.0 };
        Expected { amt, partial: true, join: Some(join), worked, dim, assumed: joined.is_none(), stipend: false }
    }
    /// The pay that started a cycle: the actual credit if it has arrived, otherwise what's expected.
    pub fn salary_for(&self, cyc: &Cyc) -> Salary {
        let exp = self.expected_for(cyc);
        let (lo, hi) = (cyc.p0 - 5 * D, cyc.p0 + 10 * D);
        let near: Vec<Row> = self.bank_tx().into_iter().filter(|t| self.is_bank(&t.t) && t.t.dir == "in" && !self.self_tx.contains(&t.t.id) && t.t.ts >= lo && t.t.ts <= hi).collect();
        let from_work: Vec<&Row> = near.iter().filter(|t| (t.man && t.t.cat == "Salary") || (t.t.amt >= 1000.0 && self.salary_re.is_match(&format!("{} {}", t.t.desc, t.t.raw)))).collect();
        let mut pool: Vec<&Row> = if !from_work.is_empty() { from_work } else { near.iter().filter(|t| exp.amt != 0.0 && t.t.amt >= 0.7 * exp.amt).collect() };
        pool.sort_by(|a, b| b.t.amt.partial_cmp(&a.t.amt).unwrap());
        if let Some(cr) = pool.first() {
            return Salary { amt: cr.t.amt, credited: Some(cr.t.ts), bank: self.bank_of(&cr.t.account).map(|b| b.key.clone()), in_balance: false, exp };
        }
        // no alert, but you set your salary account's balance on or after payday: it's already in that balance
        let sal_bank = if self.settings.hob.is_some() && self.banks.len() > 1 { self.banks.get(1) } else { self.banks.first() };
        if let Some(b) = sal_bank {
            let set_at = self.settings.get(b.at).unwrap_or(0.0) as Ms;
            if exp.amt != 0.0 && !exp.stipend && set_at >= cyc.p0 && set_at < cyc.p1 {
                return Salary { amt: exp.amt, credited: Some(cyc.p0.max(set_at.min(self.now()))), bank: Some(b.key.clone()), in_balance: true, exp };
            }
        }
        Salary { amt: exp.amt, credited: None, bank: None, in_balance: false, exp }
    }
    pub fn pay_note(&self, sal: &Salary) -> String {
        if sal.in_balance { return "in the balance you set".into(); }
        if let Some(c) = sal.credited { return format!("credited {}", time::fmt(c)); }
        let e = &sal.exp;
        if e.partial { return format!("first salary, {} of {} days{}", e.worked, e.dim, if e.assumed { format!(", if you join {}", time::fmt(e.join.unwrap_or(0))) } else { String::new() }); }
        if e.stipend { "stipend, expected".into() } else { "expected".into() }
    }
    pub fn ef_goal(&self) -> Option<&Goal> { self.goals.iter().find(|g| g.name.to_lowercase().contains("emergency")) }
    /// Splits one salary by the rule. ef_saved = what the emergency fund held before it.
    pub fn split_salary(&self, amt: f64, ef_saved: f64) -> Split {
        let r = &self.rule; let cap = r.ef_cap_x * amt;
        let ef = (r.ef * amt).min((cap - ef_saved).max(0.0));
        let savings = r.savings * amt + (r.ef * amt - ef);
        let family = r.family * amt;
        Split { amt, savings, ef, family, spend: amt - savings - ef - family, cap, ef_saved, ef_full: ef < 0.5, ef_rule: ef, ef_take: 0.0, sav_take: 0.0 }
    }
    pub fn planned_in(&self, cyc: &Cyc) -> Vec<Planned> {
        self.planned.iter().filter(|p| { let d = parse_iso(&p.due).unwrap(); d >= sod(cyc.p0) && d < sod(cyc.p1) }).cloned().collect()
    }
    pub fn split_for(&self, cyc: &Cyc, amt: Option<f64>) -> Split {
        let g = self.ef_goal();
        let mut s = self.split_salary(amt.unwrap_or_else(|| self.salary_for(cyc).amt), g.map(|g| self.goal_saved_before(g, cyc.p0)).unwrap_or(0.0));
        let due = self.planned_in(cyc);
        let mut from_shares: f64 = due.iter().filter(|p| p.from == "savings").map(|p| p.amt).sum();
        let off_top: f64 = due.iter().filter(|p| p.from != "savings").map(|p| p.amt).sum();
        let ef_take = s.ef.min(from_shares); from_shares -= ef_take;
        let sav_take = s.savings.min(from_shares); from_shares -= sav_take;
        s.ef_rule = s.ef; s.ef -= ef_take; s.savings -= sav_take; s.ef_take = ef_take; s.sav_take = sav_take; s.spend = s.spend - off_top - from_shares;
        s
    }
    pub fn rule_on(&self, d: Ms) -> bool { !self.rule.from.is_empty() && parse_iso(&self.rule.from).map(|f| sod(d) >= f).unwrap_or(false) }
    pub fn family_item(&self) -> String { format!("Money to {}", if self.family.is_empty() { "family" } else { &self.family }) }
    pub fn is_family_item(&self, p: &Planned) -> bool { !self.family.is_empty() && p.name.to_lowercase().starts_with(&self.family_item().to_lowercase()) }
    pub fn family_title(&self) -> String {
        if self.family.is_empty() { return "Family".into(); }
        let mut c = self.family.chars();
        match c.next() { Some(f) if f.is_ascii_alphanumeric() || f == '_' => f.to_uppercase().collect::<String>() + c.as_str(), _ => self.family.clone() }
    }
    pub fn emis_for(&self, g: &Goal) -> Vec<Planned> { self.planned.iter().filter(|p| p.goal.as_ref().map(|r| r.is_match(&g.name)).unwrap_or(false)).cloned().collect() }

    /// The salary the planner works on: your first salary until it has started a pay cycle, then this month's.
    pub fn plan_cycle(&self) -> Cyc {
        let c = self.pay_cycle();
        if days(self.first_payday(), c.p0) < -5 { let mut n = self.next_cycle(&c); n.upcoming = true; n } else { c }
    }
    pub fn plan_view_auto(&self) -> &'static str {
        let base = self.plan_cycle();
        if base.upcoming { return "cur"; }
        let mp = self.month_plan(&base);
        if mp.sal.credited.is_none() { return "cur"; }
        if self.still_to_set_aside(&mp).is_empty() || days(base.p0, self.today()) > 3 { "next" } else { "cur" }
    }
    pub fn plan_cycle_view(&self) -> Cyc {
        let base = self.plan_cycle();
        if base.upcoming { return base; }
        let v = self.plan_view.clone().unwrap_or_else(|| self.plan_view_auto().to_string());
        if v == "next" { let mut n = self.next_cycle(&base); n.ahead = true; n } else { base }
    }
    pub fn plan_key(cyc: &Cyc) -> String { format!("plan|{}", iso(cyc.p0)) }
    fn plan_edit(&self, cyc: &Cyc, k: &str) -> Option<f64> {
        self.overrides.get(&Self::plan_key(cyc)).and_then(|o| o.as_object()).and_then(|o| o.get(k)).and_then(|v| v.as_f64())
    }
    /// This month's split: the sliders on Plan.
    pub fn month_plan(&self, cyc: &Cyc) -> MonthPlan {
        let sal = self.salary_for(cyc);
        let rule = self.rule_on(cyc.p0);
        let o_sal = self.plan_edit(cyc, "sal");
        let sal_at = self.plan_edit(cyc, "salAt");
        // a salary you set before it came in was an estimate: once it's credited the real amount wins
        let sal_set = o_sal.is_some() && !(sal.credited.is_some() && !(sal_at.map(|a| a > sal.credited.unwrap() as f64).unwrap_or(false)));
        let amt = if sal_set { o_sal.unwrap() } else { sal.amt };
        let due = self.planned_in(cyc);
        let fixed: Vec<Planned> = due.iter().filter(|p| !self.is_family_item(p)).cloned().collect();
        let fixed_total: f64 = fixed.iter().map(|p| p.amt).sum();
        let split = if rule { Some(self.split_for(cyc, Some(amt))) } else { None };
        let def = match &split { Some(s) => PlanDef { sal: sal.amt, family: s.family, sip: s.savings, ef: s.ef },
            None => PlanDef { sal: sal.amt, family: due.iter().filter(|p| self.is_family_item(p)).map(|p| p.amt).sum(), sip: 0.0, ef: 0.0 } };
        let family = self.plan_edit(cyc, "family").unwrap_or(def.family);
        let sip = self.plan_edit(cyc, "sip").unwrap_or(def.sip);
        let ef = self.plan_edit(cyc, "ef").unwrap_or(def.ef);
        let cards = self.card_bills_for(cyc);
        let cards_total: f64 = cards.iter().map(|c| c.amt).sum();
        let edited = sal_set || ["family", "sip", "ef"].iter().any(|k| self.plan_edit(cyc, k).is_some());
        MonthPlan { cyc: *cyc, rule, sal, amt, def, family, sip, ef, fixed, fixed_total, cards, cards_total,
            spend: amt - family - sip - ef - fixed_total - cards_total, split, edited }
    }
    fn bills_from_salary(&self, cyc: &Cyc) -> bool { iso(cyc.p0) >= self.rule.bills_from }
    pub fn cards_paid_later(&self, cyc: &Cyc) -> bool { iso(cyc.p1) >= self.rule.bills_from }
    /// The card bills a salary pays: each open card's bill due from its payday to the day before the next one.
    pub fn card_bills_for(&self, cyc: &Cyc) -> Vec<CardBill> {
        if !self.bills_from_salary(cyc) { return vec![]; }
        let now = self.today();
        let (lo, hi) = (cyc.p0, cyc.p1);
        let in_win = |d: Ms| d >= lo && d < hi;
        let states: Vec<CardState> = self.open_groups(None).iter().map(|g| self.group_state(g, now)).collect();
        let back = self.owed_back(&states).parts;
        let back_of = |g: &str, billed: bool| back.iter().filter(|p| p.card == g && p.billed == billed).map(|p| p.amt).sum::<f64>();
        let mut out = vec![];
        for st in &states {
            let g = &st.key; let c = st.c; let cfg_g = &self.groups[g];
            let mut mine: Vec<CardBill> = vec![];
            if !st.pre_first && in_win(c.due) && st.billed >= 0.5 {
                mine.push(CardBill { key: g.clone(), name: self.card_short(g), total: st.billed, left: (st.billed_left - st.prev_unpaid).max(0.0), due: c.due, stmt: c.stmt, billed: true, ..Default::default() });
            }
            if in_win(c.next_due) {
                let mut amt = st.unbilled;
                for t in &self.scheduled {           // card EMIs the bank will put on that statement
                    if self.card_cfg.get(&t.account).map(|x| x.group != *g).unwrap_or(true) { continue; }
                    let cc = cycle_for(cfg_g, sod(t.ts));
                    if iso(add_days(cc.next_stmt, cfg_g.due_after)) == iso(c.next_due) { amt += t.amt; }
                }
                if amt >= 0.5 { mine.push(CardBill { key: g.clone(), name: self.card_short(g), total: amt, left: (amt - st.to_unbilled).max(0.0), due: c.next_due, stmt: c.next_stmt, billed: false, ..Default::default() }); }
            }
            let mut paid: f64 = self.eff_payments.iter().filter(|x| x.group == *g && x.ts >= lo && x.ts < hi).map(|x| x.amt).sum();
            for mut b in mine {
                let take = (b.total - b.left).max(0.0).min(paid); paid -= take;
                b.back = b.left.min(back_of(g, b.billed));
                b.amt = b.left - b.back + take; b.paid = b.left < 0.5;
                if b.amt >= 0.5 || b.back >= 0.5 { out.push(b); }
            }
        }
        out.sort_by_key(|b| b.due);
        out
    }
    /// What a month's split still has to take out of your account.
    pub fn still_to_set_aside(&self, mp: &MonthPlan) -> Vec<SetAside> {
        let (lo, hi) = (mp.cyc.p0 - 5 * D, mp.cyc.p1);
        let in_cyc = |ts: Ms| ts >= lo && ts < hi;
        let sent = |name: &str| self.tx.iter().filter(|t| in_cyc(t.ts) && self.planned_tx.get(&t.id).map(|n| n == name).unwrap_or(false)).map(|t| t.amt).sum::<f64>();
        let invested: f64 = self.tx.iter().filter(|t| self.is_bank(t) && t.out() && !self.self_tx.contains(&t.id) && in_cyc(t.ts) && !self.planned_tx.contains_key(&t.id)
            && self.with_rules(t).t.cat == "Investments").map(|t| t.amt).sum();
        let ef_logged: f64 = match self.ef_goal() {
            Some(g) => self.contribs.iter().filter(|c| c.goal == g.id && parse_iso_at(&c.date, 12).map(in_cyc).unwrap_or(false)).map(|c| c.amt).sum(),
            None => 0.0,
        };
        let mut rows = vec![
            SetAside { name: if self.family.is_empty() { "family".into() } else { self.family.clone() }, kind: "family".into(), left: mp.family - sent(&self.family_item()) },
            SetAside { name: "SIP".into(), kind: "sip".into(), left: mp.sip - sent("SIP") - invested },
            SetAside { name: "emergency fund".into(), kind: "ef".into(), left: mp.ef - sent("Emergency fund") - ef_logged },
        ];
        let tail = re_i(r"\s+\d+ of \d+$").unwrap();
        for p in &mp.fixed { rows.push(SetAside { name: tail.replace(&p.name, "").to_string(), kind: String::new(), left: p.amt - sent(&p.name) }); }
        rows.into_iter().map(|mut r| { r.left = r.left.max(0.0); r }).filter(|r| r.left >= 1.0).collect()
    }
    /// Each goal's monthly need, funded in priority order (goalPlan).
    pub fn goal_plan(&self, cyc: &Cyc) -> Vec<GoalRow> {
        let mp = self.month_plan(cyc);
        let ef = if mp.rule { self.ef_goal().cloned() } else { None };
        let mut avail = if mp.rule { mp.sip } else { (mp.spend - self.settings.buffer).max(0.0) };
        let today = self.today();
        let mut rows: Vec<GoalRow> = self.goals.iter().map(|g| {
            let due0 = parse_iso(&g.date);
            if let (Some(efg), Some(split)) = (&ef, &mp.split) {
                if g.id == efg.id {
                    let saved = self.goal_saved_before(g, i64::MAX / 4);
                    let before = self.goal_saved_before(g, cyc.p0);
                    let target = split.cap;
                    let mut gg = g.clone(); gg.target = target;
                    let rate = if split.ef_rule != 0.0 { split.ef_rule } else { 1.0 };
                    return GoalRow { g: gg, saved, moved_now: saved - before, need: mp.ef, months_left: (((target - saved) / rate).ceil() as i32).max(1), done: saved >= target - 0.5,
                        due: due0, pct: if target != 0.0 { (saved / target * 100.0).min(100.0) } else { 0.0 }, by_rule: true, emis: vec![], next_emi: None, funded: 0.0, short: 0.0 };
                }
            }
            let emis = self.emis_for(g);
            if !emis.is_empty() {
                let paid: f64 = emis.iter().filter(|p| parse_iso(&p.due).unwrap() <= today).map(|p| p.amt).sum();
                let next = emis.iter().find(|p| parse_iso(&p.due).unwrap() > today).cloned();
                let total: f64 = emis.iter().map(|p| p.amt).sum();
                let mut gg = g.clone(); gg.target = total;
                return GoalRow { g: gg, saved: paid, moved_now: 0.0, need: 0.0, months_left: 1, done: next.is_none(), due: parse_iso(&emis.last().unwrap().due),
                    pct: if total != 0.0 { (paid / total * 100.0).min(100.0) } else { 0.0 }, by_rule: false, next_emi: next, emis, funded: 0.0, short: 0.0 };
            }
            let mine: Vec<&Contrib> = self.contribs.iter().filter(|c| c.goal == g.id).collect();
            let saved = g.start + mine.iter().map(|c| c.amt).sum::<f64>();
            let before = g.start + mine.iter().filter(|c| parse_iso_at(&c.date, 12).map(|t| t < cyc.p0).unwrap_or(false)).map(|c| c.amt).sum::<f64>();
            let months_left = match due0 { Some(d) => { let (a, b) = (parts(d), parts(cyc.p0)); ((a.y - b.y) * 12 + a.m - b.m).max(1) }, None => 1 };
            let done = saved >= g.target - 0.5;
            let need = if done { 0.0 } else { ((g.target - before) / months_left as f64).ceil().max(0.0) };
            GoalRow { g: g.clone(), saved, moved_now: saved - before, need, months_left, done, due: due0, pct: if g.target != 0.0 { (saved / g.target * 100.0).min(100.0) } else { 0.0 },
                by_rule: false, emis: vec![], next_emi: None, funded: 0.0, short: 0.0 }
        }).collect();
        let prio = |g: &Goal| if g.prio == 0.0 { 2.0 } else { g.prio };
        rows.sort_by(|a, b| prio(&a.g).partial_cmp(&prio(&b.g)).unwrap().then(a.due.unwrap_or(0).cmp(&b.due.unwrap_or(0))));
        for p in rows.iter_mut() {
            if p.by_rule || !p.emis.is_empty() { p.funded = p.need; p.short = 0.0; continue; }
            let funded = p.need.min(avail); avail -= funded; p.funded = funded; p.short = p.need - funded;
        }
        rows
    }
    /// A month with no one-off payments: your salary split by your rule.
    pub fn usual_month(&self) -> Option<Usual> {
        let inc = self.settings.inc0();
        if inc == 0.0 { return None; }
        let s = self.split_salary(inc, self.ef_goal().map(|g| self.goal_saved_before(g, i64::MAX / 4)).unwrap_or(0.0));
        Some(Usual { amt: inc, family: s.family, sip: s.savings, ef: s.ef, spend: s.spend, ef_full: s.ef_full })
    }
    /// A card account's short name: "Bank Gold add-on ·1234" → "Bank Gold".
    pub fn card_short(&self, g: &str) -> String {
        match self.groups.get(g) { Some(gr) => strip_short(&gr.short), None => g.to_string() }
    }
}
pub fn strip_short(s: &str) -> String {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| Regex::new(r"\s+add-on|\s*·\d{4}").unwrap()).replace_all(s, "").to_string()
}
