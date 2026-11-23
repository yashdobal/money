//! Today: Safe to spend until payday, what needs attention, where you stand, coming up, the bank balance, a usual
//! month (rn/src/screens/Today.js).

use crate::kit::*;
use crate::state::{eng, SHEET, TAB, VER};
use dioxus::prelude::*;
use money_core::engine::{CardState, Chart, Hero};
use money_core::time::{self, Ms};

fn open(s: &str) { *SHEET.write() = Some(s.to_string()); }

#[component]
pub fn Today() -> Element {
    let _ = VER();
    let (cards, hero, net, att, spent, n_today, today) = eng(|e| {
        let cards = e.all_cards();
        let hero = e.hero_model(&cards);
        let net = e.net_model(&cards);
        let att = e.attention(&cards, &hero, net.as_ref());
        let td = e.today();
        let tx: Vec<_> = e.tx_for(Some(&time::ym_of(td)), false).into_iter().filter(|x| x.t.day == time::date(td)).collect();
        let spent = e.spend_of(&tx).spend;
        let n = tx.iter().filter(|x| x.t.out() && x.t.counted).count();
        (cards, hero, net, att, spent, n, td)
    });
    rsx! {
        div { class: "page",
            HeroCard { hero: hero.clone() }
            if !att.is_empty() {
                Panel { title: "Needs attention", i: 1,
                    div { class: "rows",
                        for (k, x) in att.iter().enumerate() {
                            Row { key: "{k}", icon: rsx! { Ic { name: icon_of(&x.icon), tone: x.tone.clone() } }, title: x.title.clone(), detail: x.detail.clone(),
                                value: x.amt.map(amt), tone: if x.tone == "alert" { "alert".to_string() } else { String::new() }, chevron: x.amt.is_none(),
                                onclick: { let go = x.go.clone(); move |_| go_to(&go) } }
                        }
                    }
                }
            }
            div { class: "tray two rise", style: "--i:2",
                Tile { label: "Where you stand", value: net.as_ref().map(|n| amt(n.now)).unwrap_or("—".into()), tone: if net.as_ref().map(|n| n.now < 0.0).unwrap_or(false) { "alert".to_string() } else { String::new() },
                    sub: if net.is_some() { "after every card".to_string() } else { "set your bank balance".to_string() }, onclick: move |_| open("net") }
                Tile { label: "Spent today", value: amt(spent), sub: if n_today > 0 { plural(n_today as i64, "payment") } else { "nothing yet".to_string() }, onclick: move |_| *TAB.write() = 4 }
            }
            ComingUp { cards: cards.clone(), hero: hero.clone(), today }
            BankPanel { hero: hero.clone() }
            Usual {}
        }
    }
}

fn icon_of(k: &str) -> String { match k { "goal" | "plan" | "bank" | "mail" | "db" | "gap" => k.to_string(), _ => "card".into() } }
fn go_to(go: &str) {
    if let Some(s) = go.strip_prefix("sheet:") { open(s); return; }
    let tab = match go.split(':').next().unwrap_or("") { "cards" => 2, "plan" => 1, "activity" => 4, "settings" => 7, _ => return };
    *TAB.write() = tab;
}

/// The Safe to spend card: the rolling figure, the line under it, the forecast chart and three tiles.
#[component]
fn HeroCard(hero: Hero) -> Element {
    let _ = VER();
    let (data_in, banks) = eng(|e| (e.data_in, e.bank_names()));
    rsx! {
        section { class: "hero rise", style: "--i:0",
            div { class: "hero-light" }
            div { class: "hero-in",
                div { class: "hero-top",
                    span { "Safe to spend until payday" }
                    button { class: "ib on-dark", aria_label: "How this is worked out", onclick: move |_| open("explain"), Icon { name: "info".to_string(), size: 19.0 } }
                }
                if hero.state != "ok" {
                    div { class: "hero-fig", if data_in { "—" } else { " " } }
                    p { class: "hero-line",
                        if !data_in { "Loading your figures…" }
                        else if hero.state == "noinc" { "Set your monthly take-home pay to see what's safe to spend." }
                        else { "Enter what your {banks} app shows once. After that, alerts keep it up to date." }
                    }
                } else {
                    Odo { value: money_core::fmt::round(hero.tiles.rest.total), class: "odo hero-fig".to_string() }
                    p { class: if hero.tone == "alert" { "hero-line alert" } else { "hero-line" }, "{hero.line}" }
                    HeroChart { c: hero.chart.clone(), start: hero.f.as_ref().map(|f| f.b.bal).unwrap_or(0.0) }
                    div { class: "hero-tiles",
                        HeroTile { label: "A day", v: hero.tiles.rest.per_day, sub: format!("for {}", plural(hero.tiles.rest.days as i64, "day")) }
                        HeroTile { label: "Next month", v: hero.tiles.next.total, sub: format!("{} a day", amt(hero.tiles.next.per_day)) }
                        if let Some(u) = hero.tiles.usual.clone() { HeroTile { label: "Usual month", v: u.total, sub: format!("{} a day", amt(u.per_day)) } }
                    }
                }
            }
        }
    }
}
#[component]
fn HeroTile(label: String, v: f64, sub: String) -> Element {
    rsx! { div { class: "h-tile", div { class: "ht-l", "{label}" } div { class: "ht-v", {shown(&amt(v))} } div { class: "ht-s", {shown(&sub)} } } }
}

/// The bank balance day by day until the salary after next: a step for each date money moves.
#[component]
fn HeroChart(c: Chart, start: f64) -> Element {
    if c.pts.is_empty() { return rsx! {}; }
    let (w, h) = (320.0, 96.0);
    let (t0, t1) = (c.from as f64, c.to as f64);
    let span = (t1 - t0).max(1.0);
    let mut pts = vec![(c.from, start)]; pts.extend(c.pts.iter().copied());
    let mut lo = pts.iter().map(|p| p.1).chain([0.0, c.buffer]).fold(f64::INFINITY, f64::min);
    let mut hi = pts.iter().map(|p| p.1).chain([0.0, c.buffer]).fold(f64::NEG_INFINITY, f64::max);
    let pad = if hi > lo { (hi - lo) * 0.12 } else { 1000.0 }; lo -= pad; hi += pad;
    let x = |d: Ms| (d as f64 - t0) / span * w;
    let y = |v: f64| h - (v - lo) / (hi - lo) * h;
    let mut d = format!("M0 {:.1}", y(pts[0].1));
    for (i, p) in pts.iter().enumerate() { if i > 0 { d += &format!("H{:.1}", x(p.0)); } d += &format!("V{:.1}", y(p.1)); }
    d += &format!("H{}", w);
    let area = format!("{}V{}H0Z", d, h);
    let zero = y(c.buffer);
    let (lx, ly) = (x(c.low.0), y(c.low.1));
    let short = c.low.1 < c.buffer;
    let paydays: Vec<f64> = c.paydays.iter().map(|p| x(*p)).filter(|v| *v < w - 1.0).collect();
    rsx! {
        div { class: "hero-chart",
            svg { view_box: "0 0 {w} {h}", preserve_aspect_ratio: "none", width: "100%", height: "{h}",
                defs { linearGradient { id: "hcFill", x1: "0", x2: "0", y1: "0", y2: "1", stop { offset: "0", stop_color: "#FFFFFF", stop_opacity: "0.28" } stop { offset: "1", stop_color: "#FFFFFF", stop_opacity: "0" } } }
                path { class: "hc-area", d: "{area}", fill: "url(#hcFill)" }
                line { x1: "0", x2: "{w}", y1: "{zero}", y2: "{zero}", stroke: "rgba(255,255,255,0.35)", stroke_width: "1", stroke_dasharray: "3 4", vector_effect: "non-scaling-stroke" }
                for (i, px) in paydays.iter().enumerate() { line { key: "{i}", x1: "{px}", x2: "{px}", y1: "0", y2: "{h}", stroke: "rgba(255,255,255,0.12)", stroke_width: "1", vector_effect: "non-scaling-stroke" } }
                path { class: "hc-line", d: "{d}", fill: "none", stroke: "#EDEDEB", stroke_width: "2", stroke_linejoin: "round", path_length: "1", vector_effect: "non-scaling-stroke" }
            }
            span { class: if short { "hc-low short" } else { "hc-low" }, style: "left:{lx / w * 100.0}%; top:{ly}px" }
            div { class: "hc-axis", span { "Today" } span { {time::fmt(c.to - 86_400_000)} } }
        }
    }
}

/// Coming up: the next few days with anything dated, grouped by day.
#[component]
fn ComingUp(cards: Vec<CardState>, hero: Hero, today: Ms) -> Element {
    let _ = VER();
    let days = eng(|e| e.coming_up(&cards, hero.f.as_ref()));
    if days.is_empty() { return rsx! {}; }
    let mut more = use_signal(|| false);
    let show = if more() { days.len() } else { days.len().min(3) };
    let rest = days.len().saturating_sub(3);
    rsx! {
        Panel { title: "Coming up", info: "about-coming".to_string(), i: 3,
            div { class: "rows",
                for (k, g) in days.iter().take(show).enumerate() {
                    DayHead { key: "h{k}", left: day_name(today, g.d), right: if g.n == 0 { time::fmt(g.d) } else { in_days(g.n) } }
                    for (j, e) in g.items.iter().enumerate() {
                        Row { key: "{k}-{j}", icon: rsx! { DotIc { kind: e.dot.clone() } }, title: e.title.clone(), detail: e.detail.clone(), soft: e.soft,
                            value: e.amt.map(|a| if e.soft { amt(a.abs()) } else { amt_s(a, "plus") }),
                            tone: if e.soft { "soft".to_string() } else if e.dot == "in" { "pos".to_string() } else if e.dot == "bill" && g.n <= 3 { "warn".to_string() } else { String::new() },
                            onclick: if e.card.is_some() { Some(EventHandler::new(move |_| *TAB.write() = 2)) } else { None } }
                    }
                }
            }
            if rest > 0 { button { class: "more", onclick: move |_| more.toggle(), if more() { "Show fewer" } else { {format!("{} more", plural(rest as i64, "day"))} } } }
        }
    }
}

/// The bank balance: today's total, the last 30 days, and the history chart.
#[component]
fn BankPanel(hero: Hero) -> Element {
    let _ = VER();
    let (h, banks, today) = eng(|e| (e.balance_history(), e.bank_names(), e.today()));
    let Some(h) = h else {
        return rsx! { Panel { title: "Bank balance", kind: "w", i: 4, Note { "Enter what your {banks} app shows once. After that, every alert keeps it up to date and builds the history." } Btn { label: "Set balances", kind: "ghost", small: true, onclick: move |_| open("balance") } } };
    };
    let n = h.pts.len();
    let pts: Vec<(Ms, f64)> = h.pts[n.saturating_sub(61)..].to_vec();
    let month = &h.pts[n.saturating_sub(31)..];
    let low = month.iter().copied().fold(month[0], |a, p| if p.1 < a.1 { p } else { a });
    let diff = h.now - month[0].1;
    let age = h.set.map(|s| time::days(s, today));
    let split = h.parts.iter().map(|p| if p.set { format!("{} {}", p.name, money_core::fmt::money(p.bal)) } else { format!("{} not set", p.name) }).collect::<Vec<_>>().join(" · ");
    let sub = format!("From your alerts{}", age.map(|a| format!(" · checked {}", match a { 0 => "today".into(), 1 => "yesterday".into(), a => format!("{} days ago", a) })).unwrap_or_default());
    let ahead: Vec<(Ms, f64)> = hero.f.as_ref().map(|f| f.segs.iter().filter(|g| g.d <= f.p1).map(|g| (g.d, g.bal)).collect()).unwrap_or_default();
    let by_payday = ahead.last().map(|a| a.1);
    rsx! {
        Panel { title: "Bank balance", kind: "w", i: 4,
            right: rsx! { div { class: "links", Btn { label: "Update", kind: "link", onclick: move |_| open("balance") } Btn { label: "History", kind: "link", onclick: move |_| open("bank") } } },
            button { class: "bank press", aria_label: "Bank balance history", onclick: move |_| open("bank"),
                div { class: "bank-top",
                    span { class: if h.now < 0.0 { "fig t-alert" } else { "fig" }, {shown(&amt(h.now))} }
                    span { class: if diff >= 0.0 { "delta t-pos" } else { "delta t-warn" }, {shown(&format!("{} {} in 30 days", if diff >= 0.0 { "▲" } else { "▼" }, amt(diff.abs())))} }
                }
                div { class: "small1", {shown(&split)} }
                div { class: "small1", "{sub}" }
                BankChart { pts: pts.clone(), ahead: ahead.clone() }
                div { class: "bank-keys",
                    span { i { class: "key-dot" } "Lowest this month " {shown(&amt(low.1))} " · {time::fmt(low.0)}" }
                    if let Some(b) = by_payday { span { i { class: "key-dash" } "By payday " {shown(&amt(b))} } }
                }
            }
        }
    }
}

/// The last two months of balance, and the forecast to payday as a dashed line.
#[component]
pub fn BankChart(pts: Vec<(Ms, f64)>, ahead: Vec<(Ms, f64)>) -> Element {
    if pts.len() < 2 { return rsx! {}; }
    let (w, h) = (320.0, 92.0);
    let t0 = pts[0].0 as f64;
    let t1 = ahead.last().map(|a| a.0).unwrap_or(pts[pts.len() - 1].0).max(pts[pts.len() - 1].0) as f64;
    let span = (t1 - t0).max(1.0);
    let vals = pts.iter().chain(ahead.iter()).map(|p| p.1);
    let lo = vals.clone().fold(f64::INFINITY, f64::min).min(0.0);
    let hi = vals.fold(f64::NEG_INFINITY, f64::max);
    let pad = if hi > lo { (hi - lo) * 0.1 } else { 1000.0 };
    let (lo, hi) = (lo - pad * 0.2, hi + pad);
    let x = |d: Ms| (d as f64 - t0) / span * w;
    let y = |v: f64| h - (v - lo) / (hi - lo) * h;
    let line = smooth(&pts.iter().map(|p| (x(p.0), y(p.1))).collect::<Vec<_>>());
    let area = format!("{}L{:.1} {}L{:.1} {}Z", line, x(pts[pts.len() - 1].0), h, x(pts[0].0), h);
    let last = pts[pts.len() - 1];
    let ahead_d = if ahead.is_empty() { String::new() } else {
        let mut a = vec![(x(last.0), y(last.1))];
        for p in &ahead { a.push((x(p.0), a.last().unwrap().1)); a.push((x(p.0), y(p.1))); }
        a.iter().enumerate().map(|(i, p)| format!("{}{:.1} {:.1}", if i == 0 { "M" } else { "L" }, p.0, p.1)).collect::<String>()
    };
    rsx! {
        div { class: "bank-chart",
            svg { view_box: "0 0 {w} {h}", preserve_aspect_ratio: "none", width: "100%", height: "{h}",
                defs { linearGradient { id: "bcFill", x1: "0", x2: "0", y1: "0", y2: "1", stop { offset: "0", stop_color: "var(--accent)", stop_opacity: "0.22" } stop { offset: "1", stop_color: "var(--accent)", stop_opacity: "0" } } }
                path { d: "{area}", fill: "url(#bcFill)" }
                path { class: "bc-line", d: "{line}", fill: "none", stroke: "var(--accent)", stroke_width: "2", stroke_linejoin: "round", path_length: "1", vector_effect: "non-scaling-stroke" }
                if !ahead_d.is_empty() { path { d: "{ahead_d}", fill: "none", stroke: "var(--ink3)", stroke_width: "1.6", stroke_dasharray: "4 4", vector_effect: "non-scaling-stroke" } }
            }
        }
    }
}
/// A smooth line through points that never overshoots (monotone cubic), as charts.js draws it.
pub fn smooth(p: &[(f64, f64)]) -> String {
    let n = p.len();
    if n < 3 { return p.iter().enumerate().map(|(i, q)| format!("{}{:.1} {:.1}", if i == 0 { "M" } else { "L" }, q.0, q.1)).collect(); }
    let mut m = vec![0.0; n];
    let d: Vec<f64> = (0..n - 1).map(|i| { let dx = p[i + 1].0 - p[i].0; if dx == 0.0 { 0.0 } else { (p[i + 1].1 - p[i].1) / dx } }).collect();
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for i in 1..n - 1 { m[i] = if d[i - 1] * d[i] <= 0.0 { 0.0 } else { (d[i - 1] + d[i]) / 2.0 }; }
    let mut s = format!("M{:.1} {:.1}", p[0].0, p[0].1);
    for i in 0..n - 1 {
        let dx = (p[i + 1].0 - p[i].0) / 3.0;
        s += &format!("C{:.1} {:.1} {:.1} {:.1} {:.1} {:.1}", p[i].0 + dx, p[i].1 + m[i] * dx, p[i + 1].0 - dx, p[i + 1].1 - m[i + 1] * dx, p[i + 1].0, p[i + 1].1);
    }
    s
}

/// A usual month: your salary split by your rule.
#[component]
fn Usual() -> Element {
    let _ = VER();
    let (u, fam) = eng(|e| (e.usual_month(), e.family_title()));
    let Some(u) = u else { return rsx! {} };
    let parts: Vec<(String, f64, &str)> = vec![(fam, u.family, "var(--n-family)"), ("SIP".into(), u.sip, "var(--n-sip)"), ("Emergency fund".into(), u.ef, "var(--n-ef)"), ("Yours to spend".into(), u.spend, "var(--n-yours)")]
        .into_iter().filter(|p| p.1 >= 1.0).collect();
    let pct = |v: f64| format!("{}%", money_core::fmt::round(v / u.amt * 100.0));
    rsx! {
        Panel { title: "A usual month", info: "about-usual".to_string(), i: 5,
            div { class: "splitbar", for p in parts.iter() { i { key: "{p.0}", style: "flex:{p.1};background:{p.2}" } } }
            div { class: "rows",
                Row { icon: rsx! { div { class: "ic ic-pos", Icon { name: "salary".to_string() } } }, title: "Salary", detail: "take-home pay", value: amt_s(u.amt, "in"), tone: "pos" }
                for p in parts.iter() {
                    Row { key: "{p.0}", icon: rsx! { div { class: "ic sw-ic", i { class: "sw", style: "background:{p.2}" } } }, title: p.0.clone(),
                        detail: if p.0 == "Yours to spend" { format!("{} a day", amt(u.spend / 30.0)) } else { format!("{} of your pay{}", pct(p.1), if p.0 == "Emergency fund" && u.ef_full { " · full" } else { "" }) },
                        value: amt_s(p.1, if p.0 == "Yours to spend" { "" } else { "out" }) }
                }
            }
        }
    }
}
