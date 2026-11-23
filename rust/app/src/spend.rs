//! Spending (rn/src/screens/Spend.js): a month's total against the month before, categories (with the ring), where
//! it went, and six months as bars.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::{CatTotal, MonthBar};
use money_core::time;

/// The month Spending shows ("" = the latest).
pub static MONTH: GlobalSignal<String> = Signal::global(String::new);

#[component]
pub fn Spend() -> Element {
    let _ = VER();
    let months = eng(|e| e.months());
    let ym = if months.contains(&MONTH()) { MONTH() } else { months.first().cloned().unwrap_or_else(|| eng(|e| time::ym_of(e.now()))) };
    let s = eng(|e| e.spend_model(&ym));
    let name = time::ym_name(&ym).split(' ').next().unwrap_or("").to_string();
    let yr = eng(|e| time::year(e.now())).to_string();
    let prev = time::ym_name(&s.prev_ym).split(' ').next().unwrap_or("").to_string();
    let vs = s.vs.map(|v| format!("{}{}% vs {}{}", if v > 0.5 { "▲ " } else if v < -0.5 { "▼ " } else { "" }, money_core::fmt::round(v.abs()) as i64, prev,
        if s.is_cur { format!(" by the {}", time::ordinal(s.up_to)) } else { String::new() }));
    let vs_tone = s.vs.map(|v| if v > 0.5 { "warn" } else if v < -0.5 { "pos" } else { "" }).unwrap_or("");
    let opts: Vec<Opt> = months.iter().take(12).map(|k| opt(k, &if k.get(0..4) == Some(yr.as_str()) { ym_short(k) } else { format!("{} {}", ym_short(k), k.get(2..4).unwrap_or("")) })).collect();
    let big = s.biggest.clone();
    let max_cat = s.cats.first().map(|c| c.amt).unwrap_or(1.0);
    let ym2 = ym.clone();
    rsx! {
        div { class: "page",
            div { class: "rise", style: "--i:0;margin-bottom:10px", Chips { scroll: true, small: true, value: ym.clone(), options: opts, onchange: move |k| *MONTH.write() = k } }
            section { key: "t{ym}", class: "panel k-d rise", style: "--i:1",
                div { class: "d-l", "Spent in {name}" }
                Odo { value: s.spend, class: "odo d-fig" }
                if let Some(v) = vs { div { class: "d-vs {tone_class(vs_tone)}", "{v}" } }
                div { class: "d-tiles",
                    Tile { label: "Per day", value: amt(s.per_day), sub: if s.is_cur { format!("over {}", plural(s.up_to as i64, "day")) } else { format!("in {}", name) } }
                    if let Some(b) = big { Tile { label: "Biggest", value: amt(b.t.amt), sub: nice(&b.t.desc).0, onclick: move |_| *SHEET.write() = Some(format!("tx:{}", b.t.id)) } }
                    else { Tile { label: "Biggest", value: "—", sub: "nothing yet" } }
                    Tile { label: format!("{}{}", money_core::fmt::take(&prev, 3), if s.is_cur { " so far" } else { "" }), value: amt(s.last_by),
                        sub: if s.is_cur { format!("by the {}", time::ordinal(s.up_to)) } else { "the whole month".to_string() } }
                }
            }
            if !s.cats.is_empty() {
                section { key: "c{ym}", class: "panel k-tray rise", style: "--i:2",
                    div { class: "panel-head", h2 { "Categories" } }
                    Donut { cats: s.cats.clone(), total: s.spend }
                    div { class: "rows",
                        for (k, c) in s.cats.iter().cloned().enumerate() {
                            button { key: "{c.name}", class: "row press", onclick: { let (n, m) = (c.name.clone(), ym2.clone()); move |_| show_activity(ActParams { cat: n.clone(), m: m.clone(), ..Default::default() }) },
                                CatIc { cat: c.name.clone() }
                                div { class: "r-main",
                                    div { class: "r-title one", "{c.name}" }
                                    div { class: "bar", i { style: "width:{c.amt / max_cat * 100.0}%;background:{cat_hue(&c.name)};animation-delay:{200 + k * 36}ms" } }
                                }
                                div { class: "r-right", div { class: "r-val", {shown(&amt(c.amt))} } div { class: "r-sub", "{money_core::fmt::round(c.pct) as i64}%" } }
                            }
                        }
                        if s.card_refunds >= 0.5 { Row { icon: rsx! { CatIc { cat: "Refunds" } }, title: "Refunds back to cards", detail: "taken off the total", value: amt(-s.card_refunds), tone: "pos" } }
                        if s.paybacks >= 0.5 { Row { icon: rsx! { CatIc { cat: "Paid back" } }, title: "Paid back by friends", detail: "taken off the total", value: amt(-s.paybacks), tone: "pos" } }
                    }
                }
            } else {
                Panel { title: "Categories", i: 2, Note { "Nothing spent in {name} yet." } }
            }
            if !s.payees.is_empty() {
                section { key: "p{ym}", class: "panel k-tray rise", style: "--i:3",
                    div { class: "panel-head", h2 { "Where it went" } }
                    div { class: "rows",
                        for (k, p) in s.payees.iter().cloned().enumerate() {
                            Row { key: "{k}", icon: rsx! { CatIc { cat: p.cat.clone() } }, title: nice(&p.name).0, detail: format!("{} · {}", plural(p.n as i64, "payment"), p.cat), value: amt(p.amt),
                                onclick: { let (n, m) = (p.name.clone(), ym.clone()); move |_| show_activity(ActParams { q: n.clone(), m: m.clone(), ..Default::default() }) } }
                        }
                    }
                }
            }
            Panel { title: "Six months", kind: "w", i: 4, right: s.avg.map(|a| rsx! { span { class: "avg", "average ", {shown(&amt(a))} } }),
                Trend { six: s.six.clone(), avg: s.avg }
            }
        }
    }
}

/// The categories as a ring, drawn round in turn.
#[component]
fn Donut(cats: Vec<CatTotal>, total: f64) -> Element {
    let r = 42.0_f64;
    let cc = 2.0 * std::f64::consts::PI * r;
    let gap = if cats.len() > 1 { 1.6 } else { 0.0 };
    let mut off = 0.0;
    let n = cats.len();
    let segs: Vec<(String, f64, f64, f64)> = cats.iter().map(|c| {
        let len = (c.amt / total * cc - gap).max(0.0);
        let o = off; off += c.amt / total * cc;
        (cat_hue(&c.name).to_string(), len, o, o / cc)
    }).collect();
    rsx! {
        div { class: "donut",
            svg { width: "150", height: "150", view_box: "0 0 120 120",
                circle { cx: "60", cy: "60", r: "42", fill: "none", stroke: "var(--inset2)", stroke_width: "16" }
                for (k, (col, len, o, start)) in segs.into_iter().enumerate() {
                    circle { key: "{k}", class: "dn-seg", cx: "60", cy: "60", r: "42", fill: "none", stroke: "{col}", stroke_width: "16",
                        stroke_dasharray: "{len:.2} {cc - len:.2}", stroke_dashoffset: "{-o:.2}", transform: "rotate(-90 60 60)",
                        style: "--len:{len:.2};--cc:{cc:.2};animation-delay:{80.0 + start * 900.0}ms" }
                }
            }
            div { class: "dn-c", b { "{n}" } span { if n == 1 { "category" } else { "categories" } } }
        }
    }
}

/// Six months as bars that grow in turn, with the average as a dashed line; tap a month to see it.
#[component]
fn Trend(six: Vec<MonthBar>, avg: Option<f64>) -> Element {
    let max = six.iter().map(|x| x.amt).chain(std::iter::once(avg.unwrap_or(0.0))).chain(std::iter::once(1.0)).fold(0.0_f64, f64::max) * 1.18;
    let h = 150.0;
    let hidden = HIDDEN();
    rsx! {
        div { class: "trend",
            div { class: "tr-bars",
                for (i, x) in six.iter().cloned().enumerate() {
                    button { key: "{x.ym}", class: "tr-col", aria_label: "{time::ym_name(&x.ym)}", onclick: { let ym = x.ym.clone(); move |_| *MONTH.write() = ym.clone() },
                        div { class: "tr-box", style: "height:{(x.amt / max * h).max(2.0)}px",
                            i { class: if x.cur { "tr-bar cur" } else { "tr-bar" }, style: "animation-delay:{60 + i * 45}ms" }
                            span { class: if x.cur { "tr-v cur" } else { "tr-v" }, if x.amt == 0.0 { "—" } else if hidden { "••" } else { {compact(x.amt)} } }
                        }
                    }
                }
                if let Some(a) = avg { b { class: "tr-avg", style: "bottom:{a / max * h}px" } }
            }
            div { class: "tr-labels", for x in six.iter() { span { key: "{x.ym}", class: if x.cur { "cur" } else { "" }, "{ym_short(&x.ym)}" } } }
        }
    }
}
