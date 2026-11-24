//! Plan (rn/src/screens/Plan.js, flow.js): the salary planner (split each salary with sliders), where it goes, the
//! calendar, goals and EMIs; and the sheets for salary settings, fixed payments, goals and moving money to one.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::{jnum, parse_float};
use money_core::fmt::{money, round};
use money_core::time::{self, Ms};
use serde_json::Value;

#[component]
pub fn Plan() -> Element {
    rsx! { div { class: "page", Planner {} Flow {} Calendar {} Goals {} Emis {} } }
}

fn pct_of(v: f64, a: f64) -> String { if a > 0.0 { format!("{}%", round(v / a * 100.0) as i64) } else { String::new() } }

#[component]
fn Planner() -> Element {
    let _ = VER();
    let mut drag = use_signal(|| None::<(String, f64)>);
    let mut last = use_signal(|| 0.0_f64);
    let inc = eng(|e| e.settings.inc.filter(|i| *i != 0.0));
    if inc.is_none() {
        return rsx! {
            Panel { title: "Your salary", kind: "w", i: 0,
                Note { "Set your monthly take-home pay and the planner splits each salary for you." }
                Btn { label: "Set take-home pay", onclick: move |_| *SHEET.write() = Some("salary".into()) }
            }
        };
    }
    let (base, view, fam, next_p0) = eng(|e| { let b = e.plan_cycle(); let v = e.plan_cycle_view(); (b, v, e.family_title(), e.next_cycle(&b).p0) });
    let mp = memo("month_plan", |e| e.month_plan(&e.plan_cycle_view()));
    let sal = &mp.sal; let ex = &sal.exp; let a = mp.amt;
    let title = format!("Your {} salary", time::fmt(if sal.in_balance { mp.cyc.p0 } else { sal.credited.unwrap_or(mp.cyc.p0) }));
    let (chip, ctone) = if sal.credited.is_some() { ("Credited", "pos") } else if ex.partial && ex.assumed { ("Not confirmed", "warn") } else { ("Estimate", "") };
    let fmt = |d: Option<Ms>| d.map(time::fmt).unwrap_or_default();
    let note = if sal.in_balance { format!("No alert for it, but it's in the balance you set on {}. Split it below; Safe to spend follows.", fmt(sal.credited)) }
        else if sal.credited.is_some() { format!("Came in on {}. Split it below; Safe to spend follows.", fmt(sal.credited)) }
        else if ex.partial { if ex.assumed { format!("Depends on your joining date: {} of {} days, as if you join {}.", ex.worked, ex.dim, fmt(ex.join)) } else { format!("You joined on {}, so it covers {} of {} days.", fmt(ex.join), ex.worked, ex.dim) } }
        else { format!("Expected on {}{}", time::fmt(mp.cyc.p0), if view.ahead { ". Plan it now; it takes over on payday." } else { ". Drag it if your payslip says otherwise." }) };
    let sal_max = ((inc.unwrap().max(mp.def.sal).max(a).max(10000.0) * 1.5) / 5000.0).ceil() * 5000.0;
    let sliders: Vec<(&str, String, &str)> = vec![("sal", "Salary".into(), "var(--ink)"), ("family", fam.clone(), "var(--n-family)"), ("sip", "SIP".into(), "var(--n-sip)"), ("ef", "Emergency fund".into(), "var(--n-ef)")];
    let one = |k: &'static str, label: String, col: &'static str| {
        let v0 = match k { "sal" => a, "family" => mp.family, "sip" => mp.sip, _ => mp.ef };
        let v = match drag() { Some((dk, dv)) if dk == k => dv, _ => v0 };
        let def = match k { "sal" => mp.def.sal, "family" => mp.def.family, "sip" => mp.def.sip, _ => mp.def.ef };
        let big = k == "sal";
        let max = if big { sal_max } else { 1000.0_f64.max((a.max(v) / 1000.0).ceil() * 1000.0) };
        let moved = (v0 - def).abs() >= 1.0;
        let was_over = mp.spend < 0.0;
        let why = match (&mp.split, moved) {
            (Some(sp), false) => if k == "ef" && sp.ef_take >= 0.5 { if v0 < 0.5 { "paused for the EMI" } else { "less the EMI" } } else if k == "ef" && sp.ef_full { "fund is full" } else if k == "sip" && sp.sav_take >= 0.5 { "after the EMI" } else { "" },
            _ => "",
        };
        let sub = if big { if moved { format!("{}{}", if sal.credited.is_some() { "credited " } else { "estimate " }, money(def)) } else { String::new() } }
            else if moved { format!("{}{}", if mp.rule { "rule " } else { "plan " }, money(def)) } else { why.to_string() };
        rsx! {
            div { key: "{k}", class: if big { "sl big" } else { "sl" },
                div { class: "sl-top",
                    if !big { i { class: "sw", style: "background:{col}" } }
                    div { class: "grow", div { class: "sl-l", "{label}" } if !sub.is_empty() { div { class: "sl-s", "{sub}" } } }
                    AmountField { value: v, big, label: label.clone(), ondone: move |n: f64| { act(|e| e.set_plan(k, n)); } }
                    if !big { span { class: "sl-p", "{pct_of(v, a)}" } }
                }
                Slider { value: v, max, color: col, label: label.clone(), marks: if def >= 1.0 { vec![def] } else { vec![] },
                    oninput: move |n: f64| {
                        drag.set(Some((k.to_string(), n)));
                        let t = js_sys::Date::now();
                        if t - last() > 70.0 {
                            last.set(t);
                            act(|e| e.set_plan(k, n));
                            // a buzz of warning the moment the split goes past what's left of the salary
                            let over = memo("month_plan", |e| e.month_plan(&e.plan_cycle_view())).spend < 0.0;
                            if over && !was_over { haptic("warn"); }
                        }
                    },
                    ondone: move |n: f64| { drag.set(None); act(|e| e.set_plan(k, n)); } }
            }
        }
    };
    let parts: Vec<(String, f64, &str)> = vec![("EMI".to_string(), mp.fixed_total, "var(--n-emi)"), (fam.clone(), mp.family, "var(--n-family)"), ("SIP".into(), mp.sip, "var(--n-sip)"),
        ("Emergency".into(), mp.ef, "var(--n-ef)"), ("Cards".into(), mp.cards_total, "var(--n-card)"), ("Yours".into(), mp.spend.max(0.0), "var(--n-yours)")]
        .into_iter().filter(|x| x.1 >= 1.0).collect();
    let base_total: f64 = parts.iter().map(|x| x.1.max(0.0)).sum::<f64>().max(1.0);
    let hidden = HIDDEN();
    let yours_sub = if mp.spend < 0.0 { if mp.cards_total >= 1.0 { "card bills and the split are more than the salary".to_string() } else { "the split is more than the salary".into() } }
        else if a > 0.0 { format!("{} of the salary{}", pct_of(mp.spend, a), if mp.cards_total >= 1.0 { ", after card bills" } else { "" }) } else { String::new() };
    rsx! {
        Panel { kind: "w", i: 0,
            div { class: "pl-head",
                div { class: "grow", div { class: "small2", "Salary planner" } div { class: "pl-t", "{title}" } }
                span { class: "badge2 b-{ctone}", "{chip}" }
            }
            if !base.upcoming {
                div { style: "margin-top:12px",
                    Seg { full: true, value: if view.ahead { "next".to_string() } else { "cur".to_string() }, onchange: move |v: String| act(|e| e.set_plan_view(&v)),
                        options: vec![opt("cur", &format!("This month · {}", time::fmt(base.p0))), opt("next", &format!("Next · {}", time::fmt(next_p0)))] }
                }
            }
            p { class: "pl-note", "{note}" }
            {one(sliders[0].0, sliders[0].1.clone(), sliders[0].2)}
            for (k, p) in mp.fixed.iter().enumerate() {
                div { key: "f{k}", class: "fixed",
                    i { class: "sw", style: "background:var(--n-emi)" }
                    div { class: "grow", div { class: "sl-l", "{p.name}" } div { class: "sl-s", "{time::parse_iso(&p.due).map(time::fmt).unwrap_or_default()} · comes off first" } }
                    span { class: "r-val", {shown(&amt_s(p.amt, "out"))} }
                }
            }
            if !mp.fixed.is_empty() { div { class: "pl-left", span { "Left to split" } b { {shown(&amt(a - mp.fixed_total))} } } }
            SubHead { text: "Split it" }
            for s in sliders.iter().skip(1) { {one(s.0, s.1.clone(), s.2)} }
            if !mp.cards.is_empty() {
                div { class: "sub-h row-h", span { "Card bills · paid from this salary" } span { {shown(&amt(-mp.cards_total))} } }
                div { class: "rows plain",
                    for (k, c) in mp.cards.iter().enumerate() {
                        Row { key: "c{k}", icon: rsx! { div { class: "ic sw-ic", i { class: "sw", style: "background:var(--n-card)" } } }, title: c.name.clone(),
                            detail: format!("{} · due {}{}{}", if c.billed { format!("bill of {}", time::fmt(c.stmt)) } else { format!("so far · bills {}", time::fmt(c.stmt)) }, time::fmt(c.due),
                                if c.paid { " · paid" } else { "" }, if c.back >= 0.5 { format!(" · {} back from others", if hidden { "••••".into() } else { money(c.back) }) } else { String::new() }),
                            value: amt_s(c.amt, "out") }
                    }
                }
            }
            div { class: "yours",
                i { class: "yours-sheen" }
                div { class: "yours-top",
                    div { class: "grow", div { class: "yours-t", "Yours to spend" } div { class: "sl-s", style: "color:var(--ink2)", "{yours_sub}" } }
                    span { class: if mp.spend < 0.0 { "fig t-alert" } else { "fig" }, {shown(&amt(mp.spend))} }
                }
                div { class: "splitbar", style: "margin:12px 0 10px",
                    for (j, (n, v, c)) in parts.iter().enumerate() { i { key: "{n}", style: "flex:{v.max(0.0) / base_total};min-width:4px;border-radius:3px;background:{c};animation-delay:{80 + j * 90}ms", class: "grow-w2" } }
                }
                div { class: "legend small", for (n, v, c) in parts.iter() { span { key: "{n}", i { style: "background:{c}" } "{n} {pct_of(*v, a)}" } } }
            }
            div { class: "pl-foot",
                if mp.edited { button { class: "btn b-link", onclick: move |_| act(|e| e.reset_plan()), if mp.rule { "Back to your rule" } else { "Back to the plan" } } } else { span {} }
                button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some("salary".into()), "Salary settings" }
            }
        }
    }
}

/// The amount beside a slider, which you can also type (an underline; the salary's is big).
#[component]
fn AmountField(value: f64, big: bool, label: String, ondone: EventHandler<f64>) -> Element {
    let mut text = use_signal(|| None::<String>);
    let shown_v = match text() { Some(t) => t, None => if HIDDEN() { "••••".into() } else { money(value) } };
    rsx! {
        input { class: if big { "amtf big" } else { "amtf" }, inputmode: "numeric", aria_label: "{label} amount in rupees", value: "{shown_v}",
            onfocus: move |_| text.set(Some(format!("{}", round(value) as i64))),
            oninput: move |e| text.set(Some(e.value().chars().filter(|c| c.is_ascii_digit() || *c == '.').collect())),
            onblur: move |_| { let v = parse_float(&text().unwrap_or_default()); text.set(None); if v.is_finite() { ondone.call(v); } },
            onkeydown: move |e| { if e.key() == Key::Enter { let v = parse_float(&text().unwrap_or_default()); text.set(None); if v.is_finite() { ondone.call(v); } } } }
    }
}

/// "Where it goes": the salary as one bar on the left, flowing out in ribbons to what it pays for.
#[component]
fn Flow() -> Element {
    let _ = VER();
    let mut sel = use_signal(|| -1_i32);
    let inc = eng(|e| e.settings.inc.filter(|i| *i != 0.0));
    if inc.is_none() { return rsx! {} }
    let (mp, fam) = (memo("month_plan", |e| e.month_plan(&e.plan_cycle_view())), eng(|e| e.family_title()));
    let a = mp.amt;
    let parts: Vec<(String, f64, &str)> = vec![("EMI".to_string(), mp.fixed_total, "var(--n-emi)"), (fam, mp.family, "var(--n-family)"), ("SIP".into(), mp.sip, "var(--n-sip)"),
        ("Emergency fund".into(), mp.ef, "var(--n-ef)"), ("Card bills".into(), mp.cards_total, "var(--n-card)"), ("Yours to spend".into(), mp.spend.max(0.0), "var(--n-yours)")]
        .into_iter().filter(|x| x.1 >= 1.0).collect();
    if parts.is_empty() || !(a > 0.0) { return rsx! {} }
    let total = a.max(parts.iter().map(|x| x.1).sum());
    let n = parts.len();
    const ROW: f64 = 40.0; const BAR: f64 = 12.0; const W: f64 = 340.0;
    let h = 200.0_f64.max(n as f64 * (ROW + 6.0));
    let nx = (W * 0.46).round(); let mx = (BAR + nx) / 2.0;
    let avail = h * if n > 1 { 0.6 } else { 1.0 };
    let gap = if n > 1 { (h - avail) / (n as f64 - 1.0) } else { 0.0 };
    let hn: Vec<f64> = parts.iter().map(|p| (p.1 / total * avail).max(3.0)).collect();
    let scale = avail / hn.iter().sum::<f64>();
    let (mut s, mut y) = (0.0, 0.0);
    let mut geo: Vec<(f64, f64, f64, f64, f64)> = vec![];   // s0 s1 n0 n1 mid
    for (i, p) in parts.iter().enumerate() {
        let hh = p.1 / total * h; let (s0, s1) = (s, s + hh); s = s1;
        let nh = hn[i] * scale; let (n0, n1) = (y, y + nh); y = n1 + gap;
        geo.push((s0, s1, n0, n1, (n0 + n1) / 2.0));
    }
    let mut lab: Vec<f64> = geo.iter().map(|g| g.4).collect();
    for i in 1..n { lab[i] = lab[i].max(lab[i - 1] + ROW); }
    if lab[n - 1] > h - ROW / 2.0 { lab[n - 1] = h - ROW / 2.0; for i in (0..n - 1).rev() { lab[i] = lab[i].min(lab[i + 1] - ROW); } }
    let pct = |v: f64| format!("{}%", round(v / total * 100.0) as i64);
    rsx! {
        Panel { title: "Where it goes", kind: "w", i: 1,
            p { class: "pl-note", style: "margin:0 0 12px", "Your {time::fmt(mp.cyc.p0)} salary, stream by stream. Tap one to pick it out." }
            div { class: "flow", style: "height:{h}px",
                svg { width: "100%", height: "{h}", view_box: "0 0 {W} {h}", preserve_aspect_ratio: "none",
                    defs {
                        for (i, p) in parts.iter().enumerate() {
                            linearGradient { key: "g{i}", id: "fl{i}", x1: "0", y1: "0", x2: "1", y2: "0",
                                stop { offset: "0", stop_color: "var(--ink)", stop_opacity: "0.1" } stop { offset: "1", stop_color: "{p.2}", stop_opacity: "0.55" } }
                        }
                    }
                    rect { class: "fl-bar", x: "0", y: "0", width: "{BAR}", height: "{h}", rx: "4", fill: "var(--ink)" }
                    for (i, (p, g)) in parts.iter().zip(geo.iter()).enumerate() {
                        g { key: "s{i}", class: "fl-s", style: format!("animation-delay:{}ms;opacity:{}", (0.15 + i as f64 * 0.09) * 900.0, if sel() >= 0 && sel() != i as i32 { 0.25 } else { 1.0 }),
                            path { d: "M{BAR} {g.0}C{mx} {g.0} {mx} {g.2} {nx} {g.2}L{nx} {g.3}C{mx} {g.3} {mx} {g.1} {BAR} {g.1}Z", fill: "url(#fl{i})" }
                            rect { x: "{nx}", y: "{g.2}", width: "10", height: "{(g.3 - g.2).max(3.0)}", rx: "3", fill: "{p.2}" }
                            path { class: "fl-dots", d: "M{BAR} {(g.0 + g.1) / 2.0}C{mx} {(g.0 + g.1) / 2.0} {mx} {g.4} {nx} {g.4}", fill: "none", stroke: "#FFFFFF",
                                stroke_width: "{((g.3 - g.2) * 0.35).clamp(1.6, 3.0)}", stroke_linecap: "round", stroke_dasharray: "0.5 14.5" }
                        }
                    }
                }
                for (i, p) in parts.iter().enumerate() {
                    button { key: "l{i}", class: "fl-lab", aria_label: "{p.0}, {pct(p.1)}", style: format!("top:{}px;left:{}%;animation-delay:{}ms;opacity:{}", lab[i].max(ROW / 2.0) - ROW / 2.0, (nx + 18.0) / W * 100.0, (0.2 + i as f64 * 0.09) * 900.0, if sel() >= 0 && sel() != i as i32 { 0.4 } else { 1.0 }),
                        onclick: move |_| { haptic("tick"); sel.set(if sel() == i as i32 { -1 } else { i as i32 }) },
                        div { class: "fl-n", span { class: "fl-name", "{p.0}" } span { class: "fl-p", "{pct(p.1)}" } }
                        div { class: "fl-v", {shown(&amt(p.1))} }
                    }
                }
            }
        }
    }
}

/// The next five weeks, Monday first; the chosen day's highlight glides to where you tap.
#[component]
fn Calendar() -> Element {
    let _ = ver_quiet();
    let today = eng(|e| e.today());
    let start = time::add_days(today, -((time::dow(today) + 6) % 7));
    let mut sel = use_signal(move || time::iso(today));
    let ev = eng(|e| { let c = e.all_cards(); let h = e.hero_model(&c); e.calendar_events(&c, h.f.as_ref()) });
    let sd = time::parse_iso(&sel()).unwrap_or(today);
    let si = time::days(start, sd).clamp(0, 34);
    let items: Vec<_> = ev.iter().filter(|e| time::iso(e.d) == sel()).cloned().collect();
    rsx! {
        Panel { title: "Calendar", kind: "w", i: 2,
            div { class: "legend small", style: "margin-bottom:10px",
                span { i { style: "background:var(--pos)" } "Money in" } span { i { style: "background:var(--alert)" } "Card bill" } span { i { style: "background:var(--ink2)" } "Transfers" } }
            div { class: "cal-dow", for (k, d) in ["M", "T", "W", "T", "F", "S", "S"].iter().enumerate() { span { key: "{k}", "{d}" } } }
            div { class: "cal",
                div { class: "cal-hl", style: "left:calc({si % 7} * 100% / 7);top:{(si / 7) * 52}px" }
                for w in 0..5 {
                    div { key: "w{w}", class: "cal-w",
                        for j in 0..7 {
                            {
                                let d = time::add_days(start, w * 7 + j);
                                let k = time::iso(d);
                                let list: Vec<&money_core::engine::CalEv> = ev.iter().filter(|e| time::iso(e.d) == k).collect();
                                let mut kinds: Vec<String> = vec![];
                                for e in &list { if e.dot != "stmt" && !kinds.contains(&e.dot) { kinds.push(e.dot.clone()); } }
                                let is_t = d == today; let past = d < today; let d1 = time::date(d) == 1;
                                let lbl = format!("{}{}", time::fmt_d(d), if list.is_empty() { String::new() } else { format!(", {}", plural(list.len() as i64, "item")) });
                                let kk = k.clone();
                                rsx! {
                                    button { key: "{k}", class: "cal-d", aria_label: "{lbl}", onclick: move |_| { if sel() != kk { haptic("tick"); } sel.set(kk.clone()) },
                                        if d1 { span { class: "cal-m", "{ym_short(&time::ym_of(d))}" } }
                                        if is_t { i { class: "cal-today" } }
                                        span { class: if is_t { "cal-n t" } else if past { "cal-n past" } else { "cal-n" }, "{time::date(d)}" }
                                        span { class: "cal-dots", for x in kinds.iter() { i { key: "{x}", class: "dot-{x}" } } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            div { class: "cal-sel",
                div { class: "cal-sel-h", b { "{day_name(today, sd)}" } span { "{time::fmt(sd)}" } }
                if items.is_empty() { p { class: "note", style: "padding:10px 0;margin:0", "Nothing on this day." } } else {
                    div { class: "rows plain",
                        for (i, e) in items.into_iter().enumerate() {
                            Row { key: "{i}", icon: rsx! { DotIc { kind: e.dot.clone() } }, soft: e.soft, title: e.title.clone(), detail: e.detail.clone(),
                                value: e.amt.map(|a| if e.soft { amt(a.abs()) } else { amt_s(a, "plus") }), tone: if e.soft { "soft".to_string() } else if e.dot == "in" { "pos".into() } else { String::new() } }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn Goals() -> Element {
    let _ = ver_quiet();
    let mut del = use_signal(|| None::<String>);
    let (list, contribs, ef) = eng(|e| (e.goal_plan(&e.pay_cycle()), e.contribs.clone(), e.rule.ef));
    let hidden = HIDDEN();
    rsx! {
        Panel { title: "Goals", info: "about-goals", i: 3,
            if list.is_empty() { Note { "No goals yet. Add one and Safe to spend makes room for it." } }
            for p in list.into_iter() {
                {
                    let g = p.g.clone();
                    let color = if p.done { "var(--pos)" } else if p.short >= 1.0 { "var(--warn)" } else { "var(--accent)" };
                    let by_emi = !p.emis.is_empty();
                    let detail = if by_emi { if p.done { "all instalments due by now".to_string() } else { p.next_emi.as_ref().map(|n| format!("next {} on {}", money(n.amt), time::parse_iso(&n.due).map(time::fmt).unwrap_or_default())).unwrap_or_default() } }
                        else if p.by_rule { format!("{}% of each salary, until full", round(ef * 100.0) as i64) }
                        else { format!("by {}{}", p.due.map(time::fmt_y).unwrap_or_default(), if p.done { String::new() } else { format!(" · {} left", plural(p.months_left as i64, "month")) }) };
                    let line = if by_emi { String::new() } else if p.done { "Reached.".into() } else { format!("This month {} planned, {} moved{}", money(p.funded), money(p.moved_now), if p.short >= 1.0 { format!(" · {} short", money(p.short)) } else { String::new() }) };
                    let mut recent: Vec<_> = contribs.iter().filter(|c| c.goal == g.id).cloned().collect();
                    recent.sort_by(|a, b| b.date.cmp(&a.date)); recent.truncate(3);
                    let prio = ["", "high", "medium", "low"].get(if g.prio == 0.0 { 2 } else { g.prio as usize }).copied().unwrap_or("");
                    let (gid, gid2, gname) = (g.id.clone(), g.id.clone(), g.name.clone());
                    let armed = del() == Some(g.id.clone());
                    rsx! {
                        div { key: "{g.id}", class: "card",
                            div { class: "goal",
                                Ring { pct: p.pct, color }
                                div { class: "grow",
                                    div { class: "goal-n", span { class: "one", "{cap(&g.name)}" } if by_emi { span { class: "badge2", "EMI" } } else if g.prio != 0.0 && !p.by_rule { span { class: "badge2", "{prio}" } } }
                                    div { class: "sl-s", "{detail}" }
                                }
                                div { class: "r-right", div { class: "r-val", {shown(&amt(p.saved))} } div { class: "r-sub", {format!("of {}", if hidden { "••••".to_string() } else { amt(g.target) })} } }
                            }
                            if !line.is_empty() { p { class: if p.short >= 1.0 { "goal-l t-warn" } else { "goal-l" }, "{line}" } }
                            div { class: "goal-b",
                                if !p.done && !by_emi { button { class: "btn small b-ghost", onclick: move |_| *SHEET.write() = Some(format!("move:{}", gid)), "Move money" } }
                                button { class: if armed { "btn small b-ghost danger" } else { "btn small b-ghost" }, onclick: move |_| {
                                    if del() != Some(gid2.clone()) {
                                        del.set(Some(gid2.clone()));
                                        let id = gid2.clone();
                                        spawn(async move { gloo_timers::future::TimeoutFuture::new(4000).await; if del() == Some(id) { del.set(None); } });
                                        return;
                                    }
                                    del.set(None); act(|e| e.del_goal(&gid2)); toast("Goal removed", "");
                                }, if armed { "Tap again to remove" } else { "Remove" } }
                            }
                            if !recent.is_empty() {
                                div { class: "rows plain goal-r",
                                    for c in recent.into_iter() {
                                        div { key: "{c.id}", class: "pay-line",
                                            Row { title: format!("{} {}", time::parse_iso(&c.date).map(time::fmt).unwrap_or_default(), &c.date[0..4.min(c.date.len())]), detail: format!("moved to {}", gname), value: amt(c.amt), tone: "pos" }
                                            button { class: "xbtn", aria_label: "Remove this move", onclick: { let id = c.id.clone(); move |_| { act(|e| e.del_contrib(&id)); toast("Move removed", ""); } }, Icon { name: "close".to_string(), size: 16.0 } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            button { class: "addrow", onclick: move |_| *SHEET.write() = Some("goal".into()), Icon { name: "plus".to_string() } span { "Add a goal" } }
        }
    }
}

/// A ring for a goal's progress, filling once.
#[component]
fn Ring(pct: f64, color: String) -> Element {
    let r = 20.0_f64; let cc = 2.0 * std::f64::consts::PI * r;
    let p = pct.clamp(0.0, 100.0) / 100.0;
    rsx! {
        div { class: "ring",
            svg { width: "52", height: "52", view_box: "0 0 48 48",
                circle { cx: "24", cy: "24", r: "20", fill: "none", stroke: "var(--inset2)", stroke_width: "5" }
                circle { class: "ring-p", cx: "24", cy: "24", r: "20", fill: "none", stroke: "{color}", stroke_width: "5", stroke_linecap: "round",
                    stroke_dasharray: "{cc:.2}", stroke_dashoffset: "{cc * (1.0 - p):.2}", transform: "rotate(-90 24 24)", style: "--cc:{cc:.2}" }
            }
            b { "{round(pct) as i64}%" }
        }
    }
}

#[component]
fn Emis() -> Element {
    let _ = ver_quiet();
    let list = eng(|e| e.emi_model());
    rsx! {
        Panel { title: "EMIs", i: 4,
            if list.is_empty() { Note { "No EMIs. Card EMIs show up here from the bank's \"EMI 1 of 3\" alerts, and fixed payments named \"… 1 of 3\" from Salary settings." } }
            for (i, x) in list.into_iter().enumerate() {
                {
                    let done = x.done >= x.tenure;
                    rsx! {
                        div { key: "{i}", class: "card emi",
                            div { class: "rows plain",
                                Row { icon: rsx! { Ic { name: if x.on == "card" { "card".to_string() } else { "bank".to_string() } } }, title: x.name.clone(),
                                    detail: format!("{}{}", if x.on == "card" { format!("on {}", x.r#where) } else { format!("from {}", x.r#where) }, if done { " · all paid".to_string() } else { x.next.as_ref().map(|n| format!(" · next {}", time::fmt(n.d))).unwrap_or_default() }),
                                    value: amt(x.per), sub: "a month" }
                            }
                            div { class: "emi-b",
                                div { class: "bar grow", i { style: format!("width:{}%;background:{}", x.done as f64 / x.tenure.max(1) as f64 * 100.0, if done { "var(--pos)" } else { "var(--accent)" }) } }
                                span { {format!("{} of {} paid{}", x.done, x.tenure, if done { String::new() } else { format!(" · {} left", money(x.left)) })} }
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ---------------- the sheets ---------------- */
fn close() { *SHEET.write() = None; }

/// Add a goal.
#[component]
pub fn GoalSheet() -> Element {
    let mut name = use_signal(String::new);
    let mut target = use_signal(String::new);
    let mut start = use_signal(String::new);
    let mut date = use_signal(String::new);
    let mut prio = use_signal(|| "2".to_string());
    rsx! {
        h2 { class: "sheet-t", "Add a goal" }
        Field { label: "What for", value: name(), placeholder: "Laptop", oninput: move |v| name.set(v) }
        div { class: "row2",
            Field { label: "Target (₹)", value: target(), numeric: true, placeholder: "1,20,000", oninput: move |v| target.set(v) }
            Field { label: "Already saved (₹)", value: start(), numeric: true, placeholder: "0", oninput: move |v| start.set(v) }
        }
        Field { label: "By", kind: "date", value: date(), placeholder: "When you want it by", oninput: move |v| date.set(v) }
        SubHead { text: "Priority" }
        Seg { value: prio(), onchange: move |v| prio.set(v), options: vec![opt("1", "High"), opt("2", "Medium"), opt("3", "Low")] }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let m = act(|e| e.add_goal(&name(), &target(), &start(), &date(), &prio()));
            if !m.is_empty() { return toast(m, "alert"); }
            close(); toast("Goal added", "");
        }, "Add goal" } }
    }
}

/// Money moved to a goal.
#[component]
pub fn MoveSheet(gid: String) -> Element {
    let (p, today) = eng(|e| (e.goal_plan(&e.pay_cycle()).into_iter().find(|x| x.g.id == gid), time::iso(e.today())));
    let Some(p) = p else { return rsx! {} };
    let v0 = format!("{}", round((p.funded - p.moved_now).max(0.0)) as i64);
    let mut v = use_signal(move || v0.clone());
    let mut d = use_signal(move || today.clone());
    let was = !p.done;
    let g = gid.clone();
    rsx! {
        h2 { class: "sheet-t", "Move money to {p.g.name}" }
        Field { label: "Amount (₹)", value: v(), numeric: true, oninput: move |t| v.set(t) }
        Field { label: "Moved on", kind: "date", value: d(), oninput: move |t| d.set(t) }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let m = act(|e| e.add_contrib(&g, &v(), &d()));
            if !m.is_empty() { return toast(m, "alert"); }
            let reached = eng(|e| e.goal_plan(&e.pay_cycle()).into_iter().find(|x| x.g.id == g).map(|q| (q.done, q.g.name.clone())));
            close();
            match reached { Some((true, n)) if was => toast(format!("{}: goal reached", n), ""), _ => toast("Moved", "") }
        }, "Save" } }
    }
}

/// A number in the salary settings that saves when you leave it: a setting (inc, buffer) or a cfg field ("offer.gross").
#[component]
fn NumF(label: String, #[props(default)] path: String, #[props(default)] setting: String, #[props(default)] pct: bool) -> Element {
    let cur: Option<f64> = eng(|e| if !setting.is_empty() { match setting.as_str() { "inc" => e.settings.inc, "buffer" => Some(e.settings.buffer), _ => None } } else {
        let c = e.cfg_now(); let mut it = path.splitn(2, '.'); let (a, b) = (it.next().unwrap_or(""), it.next().unwrap_or("")); c.get(a).and_then(|o| o.get(b)).and_then(|v| v.as_f64())
    });
    let mut v = use_signal(move || cur.map(|c| if pct { format!("{}", round(c * 1000.0) / 10.0) } else { format!("{}", c) }).unwrap_or_default());
    let (st, pa) = (setting.clone(), path.clone());
    let commit = move || {
        if !st.is_empty() { act(|e| e.set_setting(&st, &v())); return toast("Saved", ""); }
        let n = parse_float(&v());
        if !n.is_finite() || n < 0.0 { return; }
        act(|e| e.set_cfg_field(&pa, if pct { Value::from(n / 100.0) } else { jnum(n) }));
        toast("Saved", "");
    };
    let c2 = commit.clone();
    rsx! {
        label { class: "fwrap",
            span { class: "f-label one", "{label}" }
            div { class: "fld", input { inputmode: "decimal", aria_label: "{label}", value: "{v}", oninput: move |e| v.set(e.value().chars().filter(|c| c.is_ascii_digit() || *c == '.').collect()),
                onblur: move |_| commit(), onkeydown: move |e| { if e.key() == Key::Enter { c2() } } } }
        }
    }
}
/// A date in the salary settings (a setting like joined, or a cfg field), saved when picked.
#[component]
fn DateF(label: String, #[props(default)] path: String, #[props(default)] setting: String) -> Element {
    let cur = eng(|e| if !setting.is_empty() { e.settings.joined.clone() } else {
        let c = e.cfg_now(); let mut it = path.splitn(2, '.'); let (a, b) = (it.next().unwrap_or(""), it.next().unwrap_or("")); c.get(a).and_then(|o| o.get(b)).and_then(|v| v.as_str()).unwrap_or("").to_string()
    });
    rsx! {
        Field { label, kind: "date", value: cur, oninput: move |v: String| {
            if !setting.is_empty() { act(|e| e.set_setting(&setting, &v)); } else if time::is_iso(&v) { act(|e| e.set_cfg_field(&path, Value::from(v.clone()))); }
            toast("Saved", "");
        } }
    }
}

/// Salary & fixed payments: your pay, the payslip, your split, fixed payments.
#[component]
pub fn SalarySheet() -> Element {
    let _ = VER();
    let (take, r, o, inc, pay_day, fam, planned) = eng(|e| (e.regular_take_home(), e.rule.clone(), e.offer.clone(), e.settings.inc.unwrap_or(0.0), e.settings.pay_day, e.family_title(), e.planned.clone()));
    let spend_pct = 1.0 - r.savings - r.ef - r.family;
    let pf_line = if o.pf_cap < o.pf * o.basic {
        let from = time::parse_iso(&o.pf_cap_from).map(time::fmt).unwrap_or_default();
        format!("{}; {} before)", if o.pf_cap <= 0.0 { format!(" (no PF from {}", from) } else { format!(" (PF {} from {}", money(o.pf_cap), from) }, money(o.pf * o.basic))
    } else { String::new() };
    let days: Vec<(i32, String)> = vec![(0, "Last working day".into()), (31, "Last day of the month".into())].into_iter().chain((1..=30).map(|i| (i, time::ordinal(i)))).collect();
    rsx! {
        h2 { class: "sheet-t", "Salary & fixed payments" }
        h3 { class: "sub-h", style: "margin-top:6px", "Your pay" }
        div { class: "row2",
            NumF { label: "Take-home a month (₹)", setting: "inc" }
            label { class: "fwrap", span { class: "f-label", "Payday" }
                div { class: "fld", select { value: "{pay_day}", onchange: move |e| { act(|en| en.set_setting("payDay", &e.value())); toast("Saved", ""); },
                    for (v, l) in days.into_iter() { option { key: "{v}", value: "{v}", selected: v == pay_day, "{l}" } } } } }
        }
        div { class: "row2", DateF { label: "Joined on", setting: "joined" } NumF { label: "Buffer to keep (₹)", setting: "buffer" } }
        h3 { class: "sub-h", "Payslip ", span { class: "sub-s", "per month" } }
        div { class: "row2", NumF { label: "Gross (₹)", path: "offer.gross" } NumF { label: "Basic (₹)", path: "offer.basic" } }
        div { class: "row2", NumF { label: "PF (% of basic)", path: "offer.pf", pct: true } NumF { label: "Professional tax (₹)", path: "offer.pt" } }
        div { class: "row2", NumF { label: "Professional tax in Feb (₹)", path: "offer.ptFeb" } div {} }
        div { class: "row2", NumF { label: "PF later (₹; 0 = opted out)", path: "offer.pfCap" } DateF { label: "From the salary on", path: "offer.pfCapFrom" } }
        div { class: "row2", NumF { label: "Allowance (₹)", path: "offer.allow" } DateF { label: "First salary", path: "offer.firstPayday" } }
        div { class: "row2", NumF { label: "Stipend before (₹)", path: "offer.stipend" } div {} }
        div { class: "out-line", "Take-home: ", b { {shown(&money(take))} }, " a month before income tax{pf_line}" }
        if (take - inc).abs() >= 1.0 { button { class: "btn b-link", style: "margin-top:8px", onclick: move |_| { act(|e| e.use_take_home()); toast("Take-home updated", ""); }, "Use it as your take-home" } }
        h3 { class: "sub-h", "Your split ", span { class: "sub-s", "of each salary" } }
        DateF { label: "Starts with the salary on", path: "rule.from" }
        div { class: "row2", NumF { label: "SIP (%)", path: "rule.savings", pct: true } NumF { label: "Emergency (%)", path: "rule.ef", pct: true } }
        div { class: "row2", NumF { label: "{fam} (%)", path: "rule.family", pct: true } NumF { label: "Emergency stops at (× pay)", path: "rule.efCapX" } }
        DateF { label: "Card bills come out of the salary from", path: "rule.billsFrom" }
        div { class: "out-line", "Yours to spend: ", b { "{round(spend_pct * 1000.0) / 10.0}%" }, if spend_pct < 0.0 { " · the shares add up to more than 100%" } }
        h3 { class: "sub-h", "Fixed payments ", span { class: "sub-s", "set aside from the salary of their month" } }
        if planned.is_empty() { Note { "None." } } else {
            div { class: "rows plain",
                for (i, p) in planned.into_iter().enumerate() {
                    div { key: "{i}", class: "pay-line",
                        Row { title: p.name.clone(), detail: format!("{} · {}", time::parse_iso(&p.due).map(time::fmt).unwrap_or_default(), if p.from == "savings" { "savings share first" } else { "off the top" }), value: amt_s(p.amt, "out") }
                        button { class: "xbtn", aria_label: "Remove {p.name}", onclick: move |_| { act(|e| e.del_planned(i)); toast("Removed", ""); }, Icon { name: "close".to_string(), size: 16.0 } }
                    }
                }
            }
        }
        button { class: "addrow", onclick: move |_| *SHEET.write() = Some("fixed".into()), Icon { name: "plus".to_string() } span { "Add a fixed payment" } }
        div { class: "actions", button { class: "btn b-ghost big", onclick: move |_| { act(|e| e.reset_cfg()); close(); toast("Cleared", ""); }, "Clear all of these" } }
    }
}

/// Add a fixed payment (n months from the first date).
#[component]
pub fn FixedSheet() -> Element {
    let mut name = use_signal(String::new);
    let mut a = use_signal(String::new);
    let mut n = use_signal(|| "1".to_string());
    let mut due = use_signal(String::new);
    let mut from = use_signal(|| "pay".to_string());
    rsx! {
        h2 { class: "sheet-t", "Add a fixed payment" }
        Field { label: "What for", value: name(), placeholder: "Phone EMI", oninput: move |v| name.set(v) }
        div { class: "row2",
            Field { label: "Amount (₹)", value: a(), numeric: true, oninput: move |v| a.set(v) }
            Field { label: "For how many months", value: n(), numeric: true, oninput: move |v| n.set(v) }
        }
        Field { label: "First date", kind: "date", value: due(), oninput: move |v| due.set(v) }
        SubHead { text: "Paid from" }
        Seg { full: true, value: from(), onchange: move |v| from.set(v), options: vec![opt("pay", "Salary, off the top"), opt("savings", "Savings share first")] }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let m = act(|e| e.add_planned(&name(), &a(), &due(), &n(), &from()));
            if !m.is_empty() { return toast(m, "alert"); }
            *SHEET.write() = Some("salary".into()); toast("Added", "");
        }, "Add" } }
    }
}
