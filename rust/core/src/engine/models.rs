//! What the screens show: the forecast behind Safe to spend, the hero, where you stand, coming up, needs attention,
//! EMIs, card payments, and the snapshot of every figure the parity check compares (engine.js forecast … snapshot).

use super::*;
use crate::fmt::{and_list, money, money2, round};
use crate::time::{add_days, days, fmt, fmt_d, iso, parse_iso, sod};
use serde_json::json;

pub const BIG_BILL: f64 = 10000.0;

/// One dated amount in the forecast.
#[derive(Clone, Debug)]
pub struct Ev { pub d: Ms, pub amt: f64, pub kind: String, pub what: String, pub card: Option<String>, pub min: Option<f64>, pub exp: bool, pub pause: bool, pub billed: bool }
#[derive(Clone, Debug)]
pub struct Seg { pub d: Ms, pub bal: f64, pub evs: Vec<usize>, pub why: Option<usize>, pub until: Ms, pub n: i32, pub pay: Option<usize> }
#[derive(Clone, Debug)]
pub struct Env { pub left: f64, pub pace: f64 }
#[derive(Clone, Debug)]
pub struct Forecast {
    pub b: BankBalance, pub today: Ms, pub cur: Cyc, pub p1: Ms, pub p2: Ms, pub h: Ms, pub ev: Vec<Ev>, pub segs: Vec<Seg>, pub end: usize, pub low: usize,
    pub first_short: Option<usize>, pub tight: Option<usize>, pub pace: f64, pub env: Option<Env>, pub buffer: f64, pub next_pay: Option<usize>, pub next_big: Option<usize>, pub short_by: f64,
}
#[derive(Clone, Debug, Default)]
pub struct RowText { pub title: String, pub detail: String }
#[derive(Clone, Debug, Default)]
pub struct HeroRow { pub title: String, pub detail: String, pub amt: f64, pub tone: String, pub total: bool, pub up_to: bool }
#[derive(Clone, Debug, Default)]
pub struct PayRow { pub title: String, pub detail: String, pub amt: f64, pub d: Ms, pub overdue: i32 }
#[derive(Clone, Debug, Default)]
pub struct Tile { pub total: f64, pub per_day: f64, pub days: i32 }
#[derive(Clone, Debug, Default)]
pub struct Tiles { pub rest: Tile, pub next: Tile, pub usual: Option<Tile> }
#[derive(Clone, Debug, Default)]
pub struct Chart { pub pts: Vec<(Ms, f64)>, pub from: Ms, pub to: Ms, pub buffer: f64, pub low: (Ms, f64), pub paydays: Vec<Ms> }
#[derive(Clone, Debug)]
pub struct Hero { pub state: &'static str, pub f: Option<Forecast>, pub pace: f64, pub line: String, pub tone: String, pub explain: String, pub rows: Vec<HeroRow>,
    pub fixes: Vec<HeroRow>, pub left_to_find: f64, pub next_pay: Option<PayRow>, pub next_big: Option<PayRow>, pub tiles: Tiles, pub chart: Chart }
#[derive(Clone, Debug)]
pub struct NextMonth { pub mp: MonthPlan, pub status: String, pub basis: String, pub then: f64 }
#[derive(Clone, Debug)]
pub struct Net { pub b: BankBalance, pub billed: f64, pub unbilled: f64, pub back: f64, pub owe: Vec<SetAside>, pub owe_total: f64, pub owe_next: Vec<SetAside>, pub owe_next_total: f64,
    pub nxt_credited: Option<Ms>, pub now: f64, pub next: Option<NextMonth>, pub age: Option<i64> }
#[derive(Clone, Debug)]
pub struct TimelineEv { pub d: Ms, pub stmt: bool, pub what: String, pub amt: f64, pub card: Option<String>, pub kind: String, pub desc: String }
#[derive(Clone, Debug)]
pub struct CalEv { pub d: Ms, pub dot: String, pub title: String, pub detail: String, pub amt: Option<f64>, pub card: Option<String>, pub soft: bool, pub n: i32, pub overdue: bool }
#[derive(Clone, Debug)]
pub struct DayGroup { pub d: Ms, pub n: i32, pub items: Vec<CalEv> }
#[derive(Clone, Debug)]
pub struct Attn { pub tone: String, pub icon: String, pub title: String, pub detail: String, pub amt: Option<f64>, pub go: String }
#[derive(Clone, Debug)]
pub struct EmiItem { pub k: i32, pub amt: f64, pub d: Ms, pub done: bool }
#[derive(Clone, Debug)]
pub struct Emi { pub name: String, pub r#where: String, pub on: String, pub tenure: i32, pub done: i32, pub per: f64, pub next: Option<EmiItem>, pub left: f64, pub total: f64, pub last: Ms }

fn re(s: &str) -> Regex { Regex::new(s).unwrap() }
/// Bank text tidied for a title: "Phone EMI 3 of 3 (… GST) - scheduled" → "Phone EMI 3 of 3".
pub fn tidy(s: &str) -> String {
    let a = re(r"(?i)\s*-\s*(scheduled)?\s*$").replace(s, "").to_string();
    let b = re(r"\s*\([^()]*\)\s*$").replace(&a, "").to_string();
    re(r"\s+").replace_all(&b, " ").trim().to_string()
}

impl Engine {
    fn short_of(&self, card: &CardState) -> String { strip_short(&card.cfg.short) }

    /// Safe to spend: every rupee that will leave or reach your bank accounts until the day before the payday after next.
    pub fn forecast(&self, cards: &[CardState]) -> Option<Forecast> {
        let b = self.bank_balance()?;
        let today = self.today();
        let cur = self.pay_cycle(); let pc = self.plan_cycle(); let buffer = self.settings.buffer;
        let p1 = cur.p1; let p2 = self.next_cycle(&cur).p1;
        let mut ev: Vec<Ev> = vec![];
        let at = |d: Ms| if d < today { today } else { sod(d) };
        let mut add = |ev: &mut Vec<Ev>, d: Ms, amt: f64, kind: &str, what: String, f: &dyn Fn(&mut Ev)| {
            if amt.abs() >= 1.0 { let mut e = Ev { d: at(d), amt, kind: kind.into(), what, card: None, min: None, exp: false, pause: false, billed: false }; f(&mut e); ev.push(e); }
        };
        for c in cards {
            let nm = self.short_of(c);
            let k = c.key.clone();
            if c.prev_unpaid >= 0.5 { add(&mut ev, c.c.prev_due, -c.prev_unpaid, "card", format!("{} earlier bill", nm), &|e| e.card = Some(k.clone())); }
            if c.billed_left - c.prev_unpaid >= 0.5 { let m = c.min_due; add(&mut ev, c.c.due, -(c.billed_left - c.prev_unpaid), "card", format!("{} bill", nm), &|e| { e.card = Some(k.clone()); e.min = m; }); }
            if c.unbilled_left >= 0.5 { add(&mut ev, c.c.next_due, -c.unbilled_left, "card", format!("{}, spent since {}", nm, fmt(c.c.stmt)), &|e| e.card = Some(k.clone())); }
        }
        for p in self.owed_back(cards).parts {
            let c = cards.iter().find(|c| c.key == p.card).unwrap();
            add(&mut ev, p.d, p.amt, "back", self.short_of(c), &|e| { e.card = Some(p.card.clone()); e.billed = p.billed; });
        }
        let mut hh = add_days(p2, -1);
        for e in &ev { if e.d > hh { hh = e.d; } }

        // card EMIs the bank will put on a coming statement
        for t in &self.scheduled {
            let Some(g) = self.card_cfg.get(&t.account).map(|c| c.group.clone()) else { continue };
            if !self.is_open(&g, None) { continue; }
            let cfg_g = &self.groups[&g];
            let c = cycle_for(cfg_g, sod(t.ts)); let due = add_days(c.next_stmt, cfg_g.due_after);
            if due <= hh {
                let w = re(r"(?i)\s*-\s*scheduled$").replace(if t.desc.is_empty() { "Card EMI" } else { &t.desc }, "").to_string();
                let w = re(r"\s*\(.*\)$").replace(&w, "").to_string();
                add(&mut ev, due, -t.amt, "cardemi", w, &|_| {});
            }
        }
        // fixed payments from the bank (not yet paid)
        let paid_names: HashSet<String> = self.planned_tx.values().cloned().collect();
        for p in self.planned.iter().filter(|p| !self.is_family_item(p)) {
            let d = parse_iso(&p.due).unwrap();
            if d <= hh && d >= add_days(today, -7) && !paid_names.contains(&p.name) { add(&mut ev, d, -p.amt, "fixed", p.name.clone(), &|_| {}); }
        }
        // this month's salary, if a salary started it
        let fam = self.family_title();
        let mut mp_cur: Option<MonthPlan> = None;
        if !pc.upcoming {
            let m = self.month_plan(&cur);
            if m.sal.credited.is_none() && days(cur.p0, today) <= 10 {
                add(&mut ev, today, m.amt, "salary", format!("Salary, {}", self.pay_note(&m.sal)), &|e| e.exp = true);
                add(&mut ev, today, -m.family, "family", fam.clone(), &|_| {});
                add(&mut ev, today, -m.sip, "sip", "SIP".into(), &|e| e.pause = true);
                add(&mut ev, today, -m.ef, "ef", "Emergency fund".into(), &|e| e.pause = true);
            } else if m.sal.credited.is_some() {
                for r in self.still_to_set_aside(&m) {
                    if r.kind.is_empty() { continue; }
                    let what = match r.kind.as_str() { "family" => fam.clone(), "sip" => "SIP".into(), _ => "Emergency fund".into() };
                    let pause = r.kind != "family";
                    add(&mut ev, today, -r.left, &r.kind, what, &|e| e.pause = pause);
                }
            }
            if !m.rule {
                for p in self.goal_plan(&cur) {
                    if p.emis.is_empty() && !p.by_rule && p.funded - p.moved_now >= 1.0 { add(&mut ev, today, -(p.funded - p.moved_now), "goal", format!("To {}", p.g.name), &|e| e.pause = true); }
                }
            }
            mp_cur = Some(m);
        }
        // every payday in the window
        let mut cyc = self.next_cycle(&cur); let mut i = 0;
        while cyc.p0 <= hh && i < 6 {
            let mp = self.month_plan(&cyc); let when = fmt(cyc.p0);
            let note = if mp.sal.credited.is_some() { "credited".to_string() } else if mp.edited { "as planned".to_string() } else { re(r"^credited.*").replace(&self.pay_note(&mp.sal), "credited").to_string() };
            let exp = mp.sal.credited.is_none();
            add(&mut ev, cyc.p0, mp.amt, "salary", format!("Salary {}, {}", when, note), &|e| e.exp = exp);
            add(&mut ev, cyc.p0, -mp.family, "family", fam.clone(), &|_| {});
            add(&mut ev, cyc.p0, -mp.sip, "sip", "SIP".into(), &|e| e.pause = true);
            add(&mut ev, cyc.p0, -mp.ef, "ef", "Emergency fund".into(), &|e| e.pause = true);
            cyc = self.next_cycle(&cyc); i += 1;
        }

        // walk the days
        ev.sort_by(|x, y| x.d.cmp(&y.d).then(((y.amt > 0.0) as i32).cmp(&((x.amt > 0.0) as i32))).then(x.amt.partial_cmp(&y.amt).unwrap()));
        let mut dates: Vec<Ms> = ev.iter().map(|e| e.d).collect(); dates.dedup();
        let mut bal = b.bal; let mut segs: Vec<Seg> = vec![];
        if dates.is_empty() || dates[0] > today { segs.push(Seg { d: today, bal, evs: vec![], why: None, until: 0, n: 0, pay: None }); }
        for t in &dates {
            let idx: Vec<usize> = (0..ev.len()).filter(|i| ev[*i].d == *t).collect();
            for i in &idx { bal += ev[*i].amt; }
            let mut neg: Vec<usize> = idx.iter().copied().filter(|i| ev[*i].amt < 0.0).collect();
            neg.sort_by(|a, b| ev[*a].amt.partial_cmp(&ev[*b].amt).unwrap());
            segs.push(Seg { d: *t, bal, evs: idx, why: neg.first().copied(), until: 0, n: 0, pay: None });
        }
        let ns = segs.len();
        for i in 0..ns {
            segs[i].until = if i + 1 < ns { segs[i + 1].d } else { add_days(hh, 1) };
            segs[i].n = days(today, segs[i].until).max(1);
            segs[i].pay = if i + 1 < ns { segs[i + 1].evs.iter().copied().find(|e| ev[*e].kind == "salary") } else { None };
        }
        let room = |g: &Seg| g.bal - buffer;
        let end = ns - 1;
        let mut low = 0; for (i, g) in segs.iter().enumerate() { if g.bal < segs[low].bal { low = i; } }
        let first_short = segs.iter().position(|g| room(g) < 0.0);
        let mut tight = 0; for (i, g) in segs.iter().enumerate() { if room(g) / (g.n as f64) < room(&segs[tight]) / segs[tight].n as f64 { tight = i; } }
        let mut tight_o = Some(tight);
        let mut pace = (room(&segs[tight]) / segs[tight].n as f64).max(0.0);

        // the month's spending share, once a salary has started it
        let mut env = None;
        if let Some(m) = &mp_cur {
            let plan = self.goal_plan(&cur);
            let goals_total: f64 = if m.rule { 0.0 } else { plan.iter().map(|p| p.funded.max(p.moved_now)).sum() };
            let left = m.spend - goals_total - buffer - self.cycle_spend(&cur);
            let e = Env { left, pace: (left / cur.days_left as f64).max(0.0) };
            if e.pace < pace { pace = e.pace; tight_o = None; }
            env = Some(e);
        }
        let bills: Vec<usize> = (0..ev.len()).filter(|i| ev[*i].amt < 0.0 && matches!(ev[*i].kind.as_str(), "card" | "cardemi" | "fixed")).collect();
        let next_pay = bills.first().copied();
        let next_big = bills.iter().copied().find(|i| ev[*i].amt <= -BIG_BILL);
        let short_by = if first_short.is_some() { -room(&segs[low]) } else { 0.0 };
        Some(Forecast { b, today, cur, p1, p2, h: hh, ev, segs, end, low, first_short, tight: tight_o, pace, env, buffer, next_pay, next_big, short_by })
    }

    /// One forecast event as a row: a short title and one line of detail.
    pub fn ev_row(&self, e: &Ev) -> RowText {
        let when = fmt(e.d);
        let card_nm = |e: &Ev| e.card.as_ref().map(|k| self.card_short(k));
        match e.kind.as_str() {
            "card" => {
                let nm = card_nm(e).unwrap_or_else(|| re(r"(,| earlier| bill).*$").replace(&e.what, "").to_string());
                if e.what.contains(", spent since ") { return RowText { title: format!("{} bill", nm), detail: format!("spent since {} · due {}", re(r"^.*, spent since ").replace(&e.what, ""), when) }; }
                if e.what.ends_with(" earlier bill") { return RowText { title: format!("{} earlier bill", nm), detail: format!("unpaid · due {}", when) }; }
                RowText { title: format!("{} bill", nm), detail: format!("due {}", when) }
            }
            "back" => RowText { title: "Back from others".into(), detail: format!("spent for someone else on the {} · by {}", card_nm(e).unwrap_or_else(|| e.what.clone()), when) },
            "cardemi" => RowText { title: tidy(&e.what), detail: format!("on the card, due {}", when) },
            "fixed" => RowText { title: re(r"\s+(\d+) of (\d+)$").replace(&e.what, " $1/$2").to_string(), detail: when },
            "salary" => {
                let m = re(r"^Salary(?: (\d+ \w{3}))?, (.*)$").captures(&e.what);
                let first = m.as_ref().and_then(|m| m.get(1)).map(|x| format!("{}, ", x.as_str())).unwrap_or_else(|| format!("{}, ", when));
                RowText { title: "Salary".into(), detail: first + &m.as_ref().and_then(|m| m.get(2)).map(|x| x.as_str().to_string()).unwrap_or_else(|| "expected".into()) }
            }
            "family" => RowText { title: self.family_title(), detail: when },
            "sip" => RowText { title: "SIP".into(), detail: when },
            "ef" => RowText { title: "Emergency fund".into(), detail: when },
            _ => RowText { title: e.what.clone(), detail: when },
        }
    }
    /// How late the card behind a forecast event is.
    pub fn ev_overdue(&self, e: &Ev, cards: &[CardState]) -> i32 {
        let Some(c) = e.card.as_ref().and_then(|k| cards.iter().find(|c| c.key == *k)) else { return 0 };
        let due = if e.what.ends_with(" earlier bill") { c.c.prev_due } else if e.what.contains(", spent since ") { c.c.next_due } else { c.c.due };
        let n = days(self.today(), due);
        if n < 0 { -n } else { 0 }
    }

    pub fn hero_model(&self, cards: &[CardState]) -> Hero {
        let blank = |state: &'static str| Hero { state, f: None, pace: 0.0, line: String::new(), tone: String::new(), explain: String::new(), rows: vec![], fixes: vec![],
            left_to_find: 0.0, next_pay: None, next_big: None, tiles: Tiles::default(), chart: Chart::default() };
        if self.settings.inc0() == 0.0 { return blank("noinc"); }
        let Some(f) = self.forecast(cards) else { return blank("nobal") };
        let keeps = if f.buffer != 0.0 { format!("Keeps {} in the bank", money(f.buffer)) } else { "Keeps your bank above ₹0".to_string() };
        let (line, tone, explain);
        let low = &f.segs[f.low];
        if let Some(fs) = f.first_short {
            let w = low.why.map(|i| &f.ev[i]);
            let nm = w.map(|w| self.ev_row(w).title).unwrap_or_default();
            line = format!("{} short on {}", money(f.short_by), fmt_d(low.d));
            tone = "alert".to_string();
            explain = format!("Your balance would be {} short on {}{}.{}", money(f.short_by), fmt(low.d),
                w.map(|w| format!(", when the {}{}", nm, if w.kind == "card" || w.kind == "fixed" { " is due" } else { " goes out" })).unwrap_or_default(),
                if f.segs[fs].d != low.d { format!(" It first drops below {} on {}.", if f.buffer != 0.0 { "your buffer" } else { "zero" }, fmt(f.segs[fs].d)) } else { String::new() });
        } else if f.tight.is_none() {
            let env = f.env.as_ref().unwrap();
            line = format!("Your spending share until payday, {}", fmt_d(f.cur.p1));
            tone = String::new();
            explain = format!("What's left of this month's spending share, {}, spread over the {}{} until payday on {}.", money(env.left), f.cur.days_left, if f.cur.days_left == 1 { " day" } else { " days" }, fmt(f.cur.p1));
        } else {
            let g = &f.segs[f.tight.unwrap()];
            let til = if g.pay.is_some() { fmt_d(g.until) } else { fmt_d(add_days(g.until, -1)) };
            line = format!("{} until {}{}", keeps, if g.pay.is_some() { "payday, " } else { "" }, til);
            tone = String::new();
            let after = g.why.map(|i| format!("After the {} {} on {}, ", money(-f.ev[i].amt), self.ev_row(&f.ev[i]).title, fmt(g.d))).unwrap_or_default();
            explain = format!("{}{} has to last until {}.", after, money(g.bal - f.buffer), if g.pay.is_some() { format!("your salary on {}", fmt(g.until)) } else { fmt(add_days(g.until, -1)) });
        }
        // how it's worked out
        let mut rows: Vec<HeroRow> = f.b.parts.iter().filter(|p| p.set).map(|p| HeroRow { title: format!("In your {} account", p.name), detail: "tracked from alerts".into(), amt: p.bal, ..Default::default() }).collect();
        let push_ev = |rows: &mut Vec<HeroRow>, e: &Ev, tone: &str| { let r = self.ev_row(e); rows.push(HeroRow { title: r.title, detail: r.detail, amt: e.amt, tone: tone.into(), ..Default::default() }); };
        for e in f.ev.iter().filter(|e| e.kind == "salary") { push_ev(&mut rows, e, "pos"); }
        for e in f.ev.iter().filter(|e| matches!(e.kind.as_str(), "card" | "cardemi" | "fixed")) { push_ev(&mut rows, e, ""); }
        for e in f.ev.iter().filter(|e| e.kind == "back") { push_ev(&mut rows, e, "pos"); }
        for (k, title) in [("family", self.family_title()), ("sip", "SIP".into()), ("ef", "Emergency fund".into()), ("goal", "Goal money to move".into())] {
            let list: Vec<&Ev> = f.ev.iter().filter(|e| e.kind == k).collect();
            if list.is_empty() { continue; }
            let v: f64 = list.iter().map(|e| e.amt).sum();
            if v == 0.0 { continue; }
            rows.push(HeroRow { title, detail: and_list(&list.iter().map(|e| fmt(e.d)).collect::<Vec<_>>()), amt: v, ..Default::default() });
        }
        if f.buffer != 0.0 { rows.push(HeroRow { title: "Buffer you keep".into(), detail: "never spent".into(), amt: -f.buffer, ..Default::default() }); }
        let end = &f.segs[f.end];
        rows.push(HeroRow { title: format!("Left on {}", fmt(f.h)), detail: "the day before the salary after next".into(), amt: end.bal - f.buffer, total: true, ..Default::default() });
        if f.low != f.end && low.bal < end.bal - 0.5 { rows.push(HeroRow { title: "Lowest point".into(), detail: fmt_d(low.d), amt: low.bal - f.buffer, total: true, tone: if f.first_short.is_some() { "alert".into() } else { String::new() }, ..Default::default() }); }

        // ways to close a gap
        let mut fixes: Vec<HeroRow> = vec![];
        let mut left_to_find = 0.0;
        if f.first_short.is_some() {
            let before: Vec<&Ev> = f.ev.iter().filter(|e| e.d <= low.d).collect();
            for e in before.iter().filter(|e| e.kind == "sip") { fixes.push(HeroRow { title: "Skip the SIP".into(), detail: fmt(e.d), amt: -e.amt, ..Default::default() }); }
            for e in before.iter().filter(|e| e.kind == "ef") { fixes.push(HeroRow { title: "Skip the emergency-fund transfer".into(), detail: fmt(e.d), amt: -e.amt, ..Default::default() }); }
            for e in before.iter().filter(|e| e.kind == "goal") { fixes.push(HeroRow { title: "Hold off moving goal money".into(), detail: format!("{} · {}", e.what.trim_start_matches("To "), fmt(e.d)), amt: -e.amt, ..Default::default() }); }
            for e in before.iter().filter(|e| e.kind == "card" && e.min.map(|m| -e.amt - m >= 1.0).unwrap_or(false)) {
                fixes.push(HeroRow { title: "Pay only the minimum".into(), detail: format!("{} · interest applies", self.ev_row(e).title), amt: -e.amt - e.min.unwrap(), ..Default::default() });
            }
            for e in before.iter().filter(|e| e.kind == "family") { fixes.push(HeroRow { title: format!("Send less to {}", if self.family.is_empty() { "family" } else { &self.family }), detail: fmt(e.d), amt: -e.amt, up_to: true, ..Default::default() }); }
            left_to_find = (f.short_by - fixes.iter().map(|x| x.amt).sum::<f64>()).max(0.0);
        }
        let pay = |i: Option<usize>| i.map(|i| { let e = &f.ev[i]; let r = self.ev_row(e); PayRow { title: r.title, detail: r.detail, amt: -e.amt, d: e.d, overdue: self.ev_overdue(e, cards) } });
        let next_pay = pay(f.next_pay);
        let next_big = if f.next_big.is_some() && f.next_big != f.next_pay { pay(f.next_big) } else { None };
        let tiles = self.hero_tiles(&f);
        let chart = Self::balance_chart(&f);
        Hero { state: "ok", pace: f.pace, line, tone, explain, rows, fixes, left_to_find, next_pay, next_big, tiles, chart, f: Some(f) }
    }
    /// The rest of this month, next month and a usual month.
    pub fn hero_tiles(&self, f: &Forecast) -> Tiles {
        let days_left = days(f.today, f.p1).max(1);
        let rest = Tile { total: f.pace * days_left as f64, per_day: f.pace, days: days_left };
        let spent_before = f.pace * days(f.today, f.p1) as f64;
        let cyc_days = days(f.p1, f.p2).max(1);
        let after: Vec<&Seg> = f.segs.iter().filter(|g| g.d >= f.p1).collect();
        let mut next_pace = if after.is_empty() { 0.0 } else { after.iter().map(|g| (g.bal - spent_before - f.buffer) / days(f.p1, g.until).max(1) as f64).fold(f64::INFINITY, f64::min) };
        let nmp = self.month_plan(&self.next_cycle(&f.cur));
        next_pace = next_pace.min((nmp.spend - f.buffer) / cyc_days as f64).max(0.0);
        let next = Tile { total: next_pace * cyc_days as f64, per_day: next_pace, days: cyc_days };
        let usual = self.usual_month().map(|u| Tile { total: u.spend, per_day: u.spend / 30.0, days: 30 });
        Tiles { rest, next, usual }
    }
    /// The bank balance day by day until the salary after next.
    pub fn balance_chart(f: &Forecast) -> Chart {
        let end = add_days(f.h, 1);
        let low = &f.segs[f.low];
        Chart { pts: f.segs.iter().map(|g| (g.d, g.bal)).collect(), from: f.today, to: end, buffer: f.buffer, low: (low.d, low.bal), paydays: [f.p1, f.p2].into_iter().filter(|d| *d <= end).collect() }
    }

    /// Where you stand: your bank balance less every card and what this month's split still has to send.
    pub fn net_model(&self, cards: &[CardState]) -> Option<Net> {
        let b = self.bank_balance();
        let cyc = self.pay_cycle(); let inc = self.settings.inc0(); let pc = self.plan_cycle();
        let billed: f64 = cards.iter().map(|c| c.billed_left).sum();
        let unbilled: f64 = cards.iter().map(|c| c.unbilled_left).sum();
        let b = b?;
        let cur = self.month_plan(&cyc);
        let cur_in = inc != 0.0 && !pc.upcoming && cur.sal.credited.is_some();
        let owe = if cur_in { self.still_to_set_aside(&cur) } else { vec![] };
        let owe_total: f64 = owe.iter().map(|r| r.left).sum();
        let nxt = if inc == 0.0 { None } else if cur_in { Some(self.month_plan(&self.next_cycle(&cyc))) } else { Some(self.month_plan(&pc)) };
        let set_at = |k: Option<&String>| { let bk = k.and_then(|k| self.bank_by_key(k)).or(self.banks.first()); bk.map(|b| self.settings.get(b.at).unwrap_or(0.0)).unwrap_or(0.0) };
        let nxt_in = cur_in && nxt.as_ref().map(|n| n.sal.credited.map(|c| c as f64 > set_at(n.sal.bank.as_ref())).unwrap_or(false)).unwrap_or(false);
        let owe_next = if nxt_in { self.still_to_set_aside(nxt.as_ref().unwrap()) } else { vec![] };
        let owe_next_total: f64 = owe_next.iter().map(|r| r.left).sum();
        let back = self.owed_back(cards).total;
        let now = b.bal - owe_total - owe_next_total - billed - unbilled + back;
        let mut next = None;
        if let Some(n) = &nxt { if !nxt_in {
            let s = &n.sal; let e = &s.exp;
            let status = if s.credited.is_some() { "credited" } else if e.partial && e.assumed { "not confirmed" } else if e.partial { "estimate" } else { "expected" };
            next = Some(NextMonth { mp: n.clone(), status: status.into(), basis: if cur_in { "at your rule".into() } else { "from the planner".into() }, then: now + n.spend + n.cards_total });
        } }
        let age = if b.since != 0.0 { Some(((self.now() as f64 - b.since) / D as f64).floor() as i64) } else { None };
        Some(Net { nxt_credited: if nxt_in { nxt.as_ref().unwrap().sal.credited } else { None }, b, billed, unbilled, back, owe, owe_total, owe_next, owe_next_total, now, next, age })
    }

    /// Card dates: bill due, statement closes, next bill due, scheduled charges.
    pub fn card_timeline(&self, cards: &[CardState]) -> Vec<TimelineEv> {
        let mut ev = vec![];
        for c in cards {
            let s = &c.cfg.short;
            if c.prev_unpaid >= 0.5 { ev.push(TimelineEv { d: c.c.prev_due, stmt: false, what: format!("{} earlier bill, unpaid", s), amt: c.prev_unpaid, card: Some(c.key.clone()), kind: "earlier".into(), desc: String::new() }); }
            if c.billed_left - c.prev_unpaid >= 0.5 { ev.push(TimelineEv { d: c.c.due, stmt: false, what: format!("{} bill due", s), amt: c.billed_left - c.prev_unpaid, card: Some(c.key.clone()), kind: "bill".into(), desc: String::new() }); }
            ev.push(TimelineEv { d: c.c.next_stmt, stmt: true, what: format!("{} statement closes", s), amt: c.unbilled_left, card: Some(c.key.clone()), kind: "stmt".into(), desc: String::new() });
            ev.push(TimelineEv { d: c.c.next_due, stmt: false, what: format!("{} next bill due", s), amt: c.unbilled_left, card: Some(c.key.clone()), kind: "next".into(), desc: String::new() });
        }
        for t in &self.scheduled {
            let w = re(r"(?i)\s*-\s*scheduled$").replace(if t.desc.is_empty() { "Scheduled charge" } else { &t.desc }, "").to_string();
            ev.push(TimelineEv { d: sod(t.ts), stmt: true, what: format!("{} · billed to {}", w, self.acct_name(&t.account)), amt: t.amt, card: self.card_cfg.get(&t.account).map(|c| c.group.clone()), kind: "charge".into(), desc: t.desc.clone() });
        }
        ev.sort_by_key(|e| e.d);
        ev
    }
    /// Everything with a date, for Coming up and the calendar.
    pub fn calendar_events(&self, cards: &[CardState], f: Option<&Forecast>) -> Vec<CalEv> {
        let today = self.today(); let mut out = vec![];
        let ce = |d: Ms, dot: &str, title: String, detail: String, amt: Option<f64>, card: Option<String>, soft: bool| CalEv { d, dot: dot.into(), title, detail, amt, card, soft, n: 0, overdue: false };
        for e in self.card_timeline(cards) {
            let nm = e.card.as_ref().map(|k| self.card_short(k)).unwrap_or_default();
            match e.kind.as_str() {
                "earlier" => out.push(ce(e.d, "bill", format!("{} earlier bill", nm), "unpaid".into(), Some(-e.amt), e.card.clone(), false)),
                "bill" => { let st = cards.iter().find(|c| Some(&c.key) == e.card.as_ref()).map(|c| c.c.stmt).unwrap_or(0); out.push(ce(e.d, "bill", format!("{} bill due", nm), format!("billed {}", fmt(st)), Some(-e.amt), e.card.clone(), false)) }
                "stmt" => out.push(ce(e.d, "stmt", format!("{} statement", nm), if e.amt >= 0.5 { "closes · spent so far".into() } else { "closes".into() }, if e.amt >= 0.5 { Some(e.amt) } else { None }, e.card.clone(), true)),
                "next" => if e.amt >= 0.5 { out.push(ce(e.d, "bill", format!("{} next bill", nm), "due, so far".into(), Some(-e.amt), e.card.clone(), false)) },
                "charge" => out.push(ce(e.d, "bill", tidy(if e.desc.is_empty() { &e.what } else { &e.desc }), if e.card.is_some() { format!("charged to {}", nm) } else { "scheduled".into() }, Some(e.amt), e.card.clone(), true)),
                _ => {}
            }
        }
        if let Some(f) = f {
            for e in &f.ev {
                if e.kind == "card" || e.kind == "cardemi" { continue; }
                let r = self.ev_row(e); let dot = if e.kind == "salary" { "in" } else { "out" };
                let still = e.d == today && e.kind != "salary" && e.kind != "fixed" && today != f.cur.p0;
                let detail = if e.kind == "salary" { re(r"^\d+ \w{3}, ").replace(&r.detail, "").to_string() } else if e.kind == "fixed" { "fixed payment".into() } else if still { "still to set aside".into() } else { "from the salary".into() };
                out.push(ce(e.d, dot, r.title, detail, Some(e.amt), None, false));
            }
        }
        for e in out.iter_mut() { e.n = days(today, e.d); e.overdue = e.n < 0 && e.dot == "bill" && !e.soft; }
        out.sort_by(|a, b| a.d.cmp(&b.d).then(((a.dot == "in") as i32).cmp(&((b.dot == "in") as i32))));
        out
    }
    /// Coming up: from today on, grouped by day.
    pub fn coming_up(&self, cards: &[CardState], f: Option<&Forecast>) -> Vec<DayGroup> {
        let mut by_day: Vec<DayGroup> = vec![];
        for e in self.calendar_events(cards, f).into_iter().filter(|e| e.n >= 0) {
            match by_day.last_mut() { Some(l) if l.d == e.d => l.items.push(e), _ => by_day.push(DayGroup { d: e.d, n: e.n, items: vec![e] }) }
        }
        by_day
    }
    /// Needs attention.
    pub fn attention(&self, cards: &[CardState], hero: &Hero, net: Option<&Net>) -> Vec<Attn> {
        let mut out = vec![]; let today = self.today();
        let a = |tone: &str, icon: &str, title: String, detail: String, amt: Option<f64>, go: &str| Attn { tone: tone.into(), icon: icon.into(), title, detail, amt, go: go.into() };
        for c in cards {
            if c.billed_left >= 0.5 && c.due_in < 0 && !c.pre_first {
                out.push(a("alert", "card", format!("{} bill is overdue", self.card_short(&c.key)), format!("{}{} late · due {}", -c.due_in, if c.due_in == -1 { " day" } else { " days" }, fmt(if c.prev_unpaid >= 0.5 { c.c.prev_due } else { c.c.due })), Some(c.billed_left), &format!("cards:{}", c.key)));
            } else if c.billed_left >= 0.5 && c.due_in >= 0 && c.due_in <= 3 {
                out.push(a("warn", "card", format!("{} bill {}", self.card_short(&c.key), countdown(c.due_in)), format!("due {}", fmt_d(if c.due_in == 0 { today } else { add_days(today, c.due_in) })), Some(c.billed_left), &format!("cards:{}", c.key)));
            }
        }
        if let Some(f) = hero.f.as_ref().filter(|f| f.first_short.is_some()) {
            let n = hero.fixes.len();
            out.push(a("alert", "gap", format!("Short by {} on {}", money(f.short_by), fmt(f.segs[f.low].d)), if n > 0 { format!("{}{} to close the gap", n, if n == 1 { " way" } else { " ways" }) } else { "spend less until then".into() }, None, "sheet:explain"));
        }
        let un: Vec<&Tx> = self.pay_info.unresolved.iter().filter(|t| t.ts > self.now() - 60 * D).collect();
        if !un.is_empty() { out.push(a("warn", "card", if un.len() == 1 { "A card payment needs its card".into() } else { format!("{} card payments need their card", un.len()) }, "no confirmation email said which".into(), Some(un.iter().map(|t| t.amt).sum()), "cards")); }
        if self.settings.inc0() != 0.0 {
            let pc = self.plan_cycle();
            let mp = self.month_plan(&pc);
            if mp.spend < 0.0 { out.push(a("warn", "plan", "The split is more than the salary".into(), "pull a slider back on Plan".into(), Some(-mp.spend), "plan")); }
            if let Some(f) = hero.f.as_ref().filter(|f| f.env.is_some() && !pc.upcoming) {
                let cyc = f.cur; let mpc = self.month_plan(&cyc); let plan = self.goal_plan(&cyc);
                let unmoved: Vec<&GoalRow> = if mpc.rule { vec![] } else { plan.iter().filter(|p| p.funded - p.moved_now >= 1.0).collect() };
                let moves: Vec<String> = self.still_to_set_aside(&mpc).into_iter().map(|r| r.name).chain(unmoved.iter().map(|p| p.g.name.clone())).collect();
                if cyc.day_of <= 3 && !moves.is_empty() { out.push(a("info", "plan", "Payday: set money aside first".into(), and_list(&moves), None, "plan")); }
                let goals_short: f64 = plan.iter().filter(|p| !p.by_rule).map(|p| p.short).sum();
                if goals_short >= 1.0 { out.push(a("warn", "goal", format!("Goals need more than {}", if mpc.rule { "your SIP share" } else { "is free" }), "push a date back or trim a target".into(), Some(goals_short), "plan")); }
            }
        }
        if let Some(n) = net {
            if !n.b.missing.is_empty() { out.push(a("info", "bank", format!("Set your {} balance", n.b.missing.join(" and ")), "until then it counts as ₹0".into(), None, "sheet:balance")); }
            else if n.age.map(|a| a >= 30).unwrap_or(false) { out.push(a("info", "bank", "Check your bank balances".into(), format!("last set {} days ago", n.age.unwrap()), None, "sheet:balance")); }
        }
        if let Some(lr) = self.last_run { if self.now() - lr > 6 * H { out.push(a("warn", "mail", format!("No new emails read for {}", self.ago(lr).trim_end_matches(" ago")), "the collector may have stopped".into(), None, "settings")); } }
        out
    }
    pub fn ago(&self, ms: Ms) -> String {
        if ms == 0 { return "never".into(); }
        let s = ((self.now() - ms) as f64 / 1000.0).round().max(0.0) as i64;
        if s < 90 { return "just now".into(); }
        let m = (s as f64 / 60.0).round() as i64; if m < 60 { return format!("{} min ago", m); }
        let h = (m as f64 / 60.0).round() as i64; if h < 24 { return format!("{}{}", h, if h == 1 { " hour ago" } else { " hours ago" }); }
        let d = (h as f64 / 24.0).round() as i64; format!("{}{}", d, if d == 1 { " day ago" } else { " days ago" })
    }
    /// EMIs on cards and from the bank, with how many are done.
    pub fn emi_model(&self) -> Vec<Emi> {
        let today = self.today(); let now = self.now();
        let r1 = re(r"(?i)^(.*?\bEMI)\s+(\d+)\s+of\s+(\d+)");
        struct G { name: String, r#where: String, on: String, n: i32, items: Vec<EmiItem> }
        let mut keys: Vec<String> = vec![]; let mut groups: HashMap<String, G> = HashMap::new();
        for t in self.tx.iter().chain(self.scheduled.iter()) {
            let Some(cc) = self.card_cfg.get(&t.account) else { continue };
            if !t.out() || !self.is_open(&cc.group, None) { continue; }
            let Some(m) = r1.captures(&t.desc) else { continue };
            let key = format!("{}|{}|{}", m[1].to_lowercase(), cc.group, &m[3]);
            if !groups.contains_key(&key) { keys.push(key.clone()); groups.insert(key.clone(), G { name: m[1].trim().to_string(), r#where: self.card_short(&cc.group), on: "card".into(), n: m[3].parse().unwrap_or(0), items: vec![] }); }
            groups.get_mut(&key).unwrap().items.push(EmiItem { k: m[2].parse().unwrap_or(0), amt: t.amt, d: sod(t.ts), done: t.ts <= now });
        }
        let pre = re(r"^(.*?)\s+(\d+) of (\d+)$");
        let paid: HashSet<String> = self.planned_tx.values().cloned().collect();
        for p in &self.planned {
            let Some(m) = pre.captures(&p.name) else { continue };
            let key = format!("{}|bank|{}", m[1].to_lowercase(), &m[3]);
            if !groups.contains_key(&key) { keys.push(key.clone()); groups.insert(key.clone(), G { name: m[1].trim().to_string(), r#where: "Bank".into(), on: "bank".into(), n: m[3].parse().unwrap_or(0), items: vec![] }); }
            let d = parse_iso(&p.due).unwrap();
            groups.get_mut(&key).unwrap().items.push(EmiItem { k: m[2].parse().unwrap_or(0), amt: p.amt, d, done: paid.contains(&p.name) || d <= today });
        }
        let mut out: Vec<Emi> = keys.iter().map(|k| {
            let g = groups.get_mut(k).unwrap();
            g.items.sort_by_key(|i| i.k);
            let done: Vec<&EmiItem> = g.items.iter().filter(|i| i.done).collect();
            let next = g.items.iter().find(|i| !i.done).cloned();
            let per = g.items.last().unwrap().amt;
            let unknown = (g.n - g.items.len() as i32).max(0) as f64;
            Emi { name: g.name.clone(), r#where: g.r#where.clone(), on: g.on.clone(), tenure: g.n, done: done.iter().map(|i| i.k).max().unwrap_or(0), per,
                left: g.items.iter().filter(|i| !i.done).map(|i| i.amt).sum::<f64>() + unknown * per, total: g.items.iter().map(|i| i.amt).sum::<f64>() + unknown * per,
                last: g.items.last().unwrap().d, next }
        }).collect();
        out.sort_by(|a, b| ((a.done >= a.tenure) as i32).cmp(&((b.done >= b.tenure) as i32)).then(a.next.as_ref().map(|n| n.d).unwrap_or(0).cmp(&b.next.as_ref().map(|n| n.d).unwrap_or(0))));
        out
    }
    pub fn source_note(c: &CardState) -> String {
        match c.source.as_str() { "you" => "entered by you".into(), "alerts" => "added up from alerts — no statement email yet".into(), "CRED" => "from CRED's bill email".into(), s => format!("from {}'s statement", s) }
    }
    fn pay_bank(&self, p: &EffPayment) -> String {
        p.tx_id.as_ref().and_then(|id| self.tx.iter().find(|x| &x.id == id)).and_then(|t| self.bank_of(&t.account)).map(|b| b.name.clone()).unwrap_or_else(|| "your bank".into())
    }
    /// The payments shown under a card: the last few since the statement before this one.
    pub fn card_payments(&self, c: &CardState) -> Vec<(EffPayment, String, String, String)> {
        let since = c.c.prev_stmt - 5 * D;
        let mut ps: Vec<&EffPayment> = self.eff_payments.iter().filter(|p| p.group == c.key && p.ts > since).collect();
        ps.sort_by(|a, b| b.ts.cmp(&a.ts)); ps.truncate(6);
        ps.into_iter().map(|p| {
            let before = p.ts <= c.from;
            let how = match p.kind.as_str() { "confirmed" => format!("{} confirmed{}", p.srcs.join(" + "), if p.tx_id.is_some() { "" } else { ", not from your bank" }), "inferred" => format!("matched from {}", self.pay_bank(p)), _ => "entered by you".into() };
            let off = if p.saved >= 0.5 { format!("{}{} off", if p.kind == "confirmed" { "CRED took " } else { "assuming CRED took " }, money2(p.saved)) } else { String::new() };
            let bt = if before { if c.source == "alerts" { "paid the earlier bill".into() } else { "in this bill".into() } } else { String::new() };
            (p.clone(), how, off, bt)
        }).collect()
    }

    /// Every figure, for the parity check against engine.js snapshot().
    pub fn snapshot(&mut self) -> Value {
        let r2 = |v: f64| { let x = round(v * 100.0) / 100.0; if x == 0.0 { 0.0 } else { x } };
        let d = |x: Option<Ms>| x.map(|t| Value::from(iso(t))).unwrap_or(Value::Null);
        self.resolve_payments();
        let cards = self.all_cards();
        let f = self.forecast(&cards);
        let mut out = serde_json::Map::new();
        out.insert("forecast".into(), match &f { None => Value::Null, Some(f) => json!({
            "pace": r2(f.pace), "shortBy": r2(f.short_by), "low": iso(f.segs[f.low].d), "lowBal": r2(f.segs[f.low].bal), "end": r2(f.segs[f.end].bal), "H": iso(f.h),
            "first": d(f.first_short.map(|i| f.segs[i].d)), "env": f.env.as_ref().map(|e| Value::from(r2(e.left))).unwrap_or(Value::Null), "tight": d(f.tight.map(|i| f.segs[i].d)),
            "ev": f.ev.iter().map(|e| json!([iso(e.d), r2(e.amt), e.kind, e.what])).collect::<Vec<_>>(),
            "segs": f.segs.iter().map(|s| json!([iso(s.d), r2(s.bal), s.n])).collect::<Vec<_>>(),
            "nextPay": f.next_pay.map(|i| json!([iso(f.ev[i].d), r2(f.ev[i].amt), f.ev[i].what])).unwrap_or(Value::Null),
            "nextBig": f.next_big.map(|i| json!([iso(f.ev[i].d), r2(f.ev[i].amt), f.ev[i].what])).unwrap_or(Value::Null) }) });
        let pc = self.plan_cycle(); let mp = self.month_plan(&pc);
        out.insert("plan".into(), json!({ "p0": iso(mp.cyc.p0), "amt": r2(mp.amt), "family": r2(mp.family), "sip": r2(mp.sip), "ef": r2(mp.ef), "spend": r2(mp.spend),
            "fixed": r2(mp.fixed_total), "rule": mp.rule, "edited": mp.edited, "credited": d(mp.sal.credited), "upcoming": pc.upcoming }));
        out.insert("goals".into(), Value::from(self.goal_plan(&self.pay_cycle()).iter().map(|p| json!({ "id": p.g.id, "saved": r2(p.saved), "need": r2(p.need), "funded": r2(p.funded),
            "short": r2(p.short), "moved": r2(p.moved_now), "target": r2(p.g.target), "done": p.done, "months": p.months_left })).collect::<Vec<_>>()));
        out.insert("cards".into(), Value::from(cards.iter().map(|c| json!({ "k": c.key, "billed": r2(c.billed), "billedLeft": r2(c.billed_left), "unbilled": r2(c.unbilled),
            "unbilledLeft": r2(c.unbilled_left), "paid": r2(c.paid), "toBilled": r2(c.to_billed), "prevUnpaid": r2(c.prev_unpaid), "owed": r2(c.owed), "state": c.state, "dueIn": c.due_in,
            "due": iso(c.c.due), "stmt": iso(c.c.stmt), "nextDue": iso(c.c.next_due), "prevDue": iso(c.c.prev_due), "source": c.source, "min": c.min_due,
            "refunds": r2(c.refunds), "credit": r2(c.credit) })).collect::<Vec<_>>()));
        let mut pays: Vec<String> = self.eff_payments.iter().map(|p| format!("{}|{}|{}|{}|{}", p.group, p.ts, num_js(r2(p.amt)), p.kind, p.tx_id.clone().unwrap_or_default())).collect();
        pays.sort();
        out.insert("payments".into(), Value::from(pays));
        out.insert("unresolved".into(), Value::from(self.pay_info.unresolved.iter().map(|t| t.id.clone()).collect::<Vec<_>>()));
        let n = self.net_model(&cards);
        out.insert("net".into(), match &n { None => Value::Null, Some(n) => json!({ "bal": r2(n.b.bal), "inn": r2(n.b.inn), "out": r2(n.b.out),
            "owe": n.owe.iter().map(|r| json!([r.name, r2(r.left)])).collect::<Vec<_>>(), "oweNext": n.owe_next.iter().map(|r| json!([r.name, r2(r.left)])).collect::<Vec<_>>(),
            "billed": r2(n.billed), "unbilled": r2(n.unbilled), "now": r2(n.now),
            "next": n.next.as_ref().map(|x| json!({ "p0": iso(x.mp.cyc.p0), "amt": r2(x.mp.amt), "family": r2(x.mp.family), "sip": r2(x.mp.sip), "ef": r2(x.mp.ef),
                "fixed": x.mp.fixed.iter().map(|p| json!([p.name, r2(p.amt)])).collect::<Vec<_>>(), "then": r2(x.then) })).unwrap_or(Value::Null) }) });
        out.insert("timeline".into(), Value::from(self.card_timeline(&cards).iter().map(|e| json!([iso(e.d), e.stmt, e.what, r2(e.amt)])).collect::<Vec<_>>()));
        let mut months = serde_json::Map::new();
        let yms: std::collections::BTreeSet<String> = self.tx.iter().map(|x| x.ym.clone()).chain(self.manual.iter().map(|m| m.ym.clone())).collect();
        for ym in yms {
            let s = self.spend_model(&ym);
            let mut by_day = serde_json::Map::new();
            for (i, v) in s.by_day.iter().enumerate() { if *v != 0.0 { by_day.insert((i + 1).to_string(), Value::from(r2(*v))); } }
            let mut cats: Vec<Value> = s.cats.iter().map(|c| json!([c.name, r2(c.amt)])).collect(); cats.sort_by_key(js_join);
            let mut accts: Vec<Value> = s.accts.iter().map(|a| json!([a.name, r2(a.out), a.n])).collect(); accts.sort_by_key(js_join);
            let mut tx: Vec<Value> = s.tx.iter().map(|x| json!([x.t.id, x.t.account, x.t.cat, x.t.counted, r2(x.t.amt), x.t.dir, x.t.day, x.paid_back, x.planned])).collect(); tx.sort_by_key(js_join);
            months.insert(ym, json!({ "spend": r2(s.spend), "cardOut": r2(s.card_out), "skipped": r2(s.skipped), "cardRefunds": r2(s.card_refunds), "paybacks": r2(s.paybacks),
                "cats": cats, "accts": accts, "byDay": by_day, "tx": tx }));
        }
        out.insert("months".into(), Value::Object(months));
        out.insert("trend".into(), Value::from(self.trend_all().iter().map(|(k, v)| json!([k, r2(*v)])).collect::<Vec<_>>()));
        out.insert("scheduled".into(), Value::from(self.scheduled.iter().map(|t| t.id.clone()).collect::<Vec<_>>()));
        Value::Object(out)
    }
}

/// An array as JavaScript's sort() compares it: its items joined with commas (null as nothing).
pub fn js_join(v: &Value) -> String {
    match v {
        Value::Array(a) => a.iter().map(|x| match x { Value::Null => String::new(), Value::String(s) => s.clone(), Value::Number(n) => num_js(n.as_f64().unwrap_or(0.0)), Value::Bool(b) => b.to_string(), o => js_join(o) }).collect::<Vec<_>>().join(","),
        Value::String(s) => s.clone(),
        o => o.to_string(),
    }
}
/// A number as JavaScript prints it in a string ("12.5", "1000").
pub fn num_js(x: f64) -> String { if x.fract() == 0.0 && x.abs() < 1e15 { format!("{}", x as i64) } else { format!("{}", x) } }

impl Engine {
    /// What Today shows, in words (the parity check compares it with tools/rust/snapshot.mjs's `screens`).
    pub fn screens(&mut self) -> Value {
        let r2 = |v: f64| { let x = round(v * 100.0) / 100.0; if x == 0.0 { 0.0 } else { x } };
        self.resolve_payments();
        let cards = self.all_cards();
        let h = self.hero_model(&cards);
        let net = self.net_model(&cards);
        let t = |x: &Tile| json!([r2(x.total), r2(x.per_day), x.days]);
        let pay = |p: &Option<PayRow>| p.as_ref().map(|p| json!([p.title, p.detail, r2(p.amt), iso(p.d), p.overdue])).unwrap_or(Value::Null);
        let hero = if h.state != "ok" { json!({ "state": h.state }) } else { json!({
            "state": h.state, "pace": r2(h.pace), "line": h.line, "tone": h.tone, "explain": h.explain,
            "rows": h.rows.iter().map(|r| json!([r.title, r.detail, r2(r.amt), r.tone, r.total])).collect::<Vec<_>>(),
            "fixes": h.fixes.iter().map(|r| json!([r.title, r.detail, r2(r.amt), r.up_to])).collect::<Vec<_>>(), "leftToFind": r2(h.left_to_find),
            "nextPay": pay(&h.next_pay), "nextBig": pay(&h.next_big),
            "tiles": [t(&h.tiles.rest), t(&h.tiles.next), h.tiles.usual.as_ref().map(t).unwrap_or(Value::Null)],
            "chart": [h.chart.pts.iter().map(|p| json!([iso(p.0), r2(p.1)])).collect::<Vec<_>>(), iso(h.chart.from), iso(h.chart.to), r2(h.chart.buffer),
                [iso(h.chart.low.0), r2(h.chart.low.1)], h.chart.paydays.iter().map(|d| iso(*d)).collect::<Vec<_>>()] }) };
        let attention: Vec<Value> = self.attention(&cards, &h, net.as_ref()).iter().map(|a| json!([a.tone, a.icon, a.title, a.detail, a.amt.map(r2)])).collect();
        let coming: Vec<Value> = self.coming_up(&cards, h.f.as_ref()).iter().map(|g| json!([iso(g.d), g.n,
            g.items.iter().map(|i| json!([i.dot, i.title, i.detail, i.amt.map(r2), i.soft, i.overdue])).collect::<Vec<_>>()])).collect();
        let emis: Vec<Value> = self.emi_model().iter().map(|x| json!([x.name, x.r#where, x.on, x.tenure, x.done, r2(x.per),
            x.next.as_ref().map(|n| json!([n.k, r2(n.amt), iso(n.d)])).unwrap_or(Value::Null), r2(x.left), r2(x.total), iso(x.last)])).collect();
        let history = self.balance_history().map(|h| json!([h.pts.iter().map(|p| json!([iso(p.0), r2(p.1)])).collect::<Vec<_>>(),
            h.marks.iter().map(|m| json!([iso(m.d), m.kind, r2(m.amt), m.title])).collect::<Vec<_>>(), r2(h.now), h.set.map(|s| Value::from(iso(s))).unwrap_or(Value::Null), h.missing])).unwrap_or(Value::Null);
        json!({ "hero": hero, "attention": attention, "coming": coming, "history": history, "emis": emis })
    }
}
