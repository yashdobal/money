//! The pieces every screen is built from, as in rn/src/kit.js: amounts, a panel (tray), rows as white cards, tiles,
//! the icon square, day headings, notes, buttons and the rolling figure. Sizes and colours are the current app's;
//! the look itself is web/style.css.

use crate::state::{HIDDEN, SHEET};
use dioxus::prelude::*;
use money_core::fmt::{group_in, round};
use money_core::time::{self, Ms};
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

/* ---------------- amounts ---------------- */
pub fn rup(v: f64) -> String { format!("₹{}", group_in(round(v.abs()) as u64)) }
/// amt(n, {sign}): "out" → −₹, "in" → +₹, "plus" → + or −, "" → − only when below zero.
pub fn amt_s(n: f64, sign: &str) -> String {
    let v = n.abs();
    let s = match sign {
        "out" => if v >= 0.5 { "−" } else { "" },
        "in" => if v >= 0.5 { "+" } else { "" },
        "plus" => if n < 0.0 && v >= 0.5 { "−" } else if v >= 0.5 { "+" } else { "" },
        _ => if n < 0.0 && v >= 0.5 { "−" } else { "" },
    };
    format!("{}{}", s, rup(v))
}
pub fn amt(n: f64) -> String { amt_s(n, "") }
/// What's shown: the amount, or dots when amounts are hidden.
pub fn shown(t: &str) -> String { if *HIDDEN.read() && t.chars().any(|c| c.is_ascii_digit()) { "₹••••".into() } else { t.to_string() } }
pub fn plural(n: i64, one: &str) -> String { format!("{} {}{}", n, one, if n == 1 { "" } else { "s" }) }
pub fn in_days(n: i32) -> String { match n { 0 => "today".into(), 1 => "tomorrow".into(), n if n < 0 => format!("{} ago", plural(-n as i64, "day")), n => format!("in {}", plural(n as i64, "day")) } }
pub fn day_name(today: Ms, d: Ms) -> String { match time::days(today, d) { 0 => "Today".into(), 1 => "Tomorrow".into(), -1 => "Yesterday".into(), _ => time::fmt_d(d) } }
pub fn tone_class(t: &str) -> &'static str { match t { "pos" => "t-pos", "alert" => "t-alert", "warn" => "t-warn", "info" => "t-info", "soft" => "t-soft", _ => "" } }

/* ---------------- icons (rn/src/icon-paths.js, the same drawings) ---------------- */
fn icons() -> &'static HashMap<String, String> {
    static I: OnceLock<HashMap<String, String>> = OnceLock::new();
    I.get_or_init(|| {
        let re = Regex::new(r"^\s+(\w+):\s*'(.*)',?\s*$").unwrap();
        include_str!("../../../rn/src/icon-paths.js").lines().filter_map(|l| re.captures(l).map(|c| (c[1].to_string(), c[2].to_string()))).collect()
    })
}
#[component]
pub fn Icon(name: String, #[props(default = 20.0)] size: f64, #[props(default = 1.8)] sw: f64) -> Element {
    let p = icons().get(&name).cloned().unwrap_or_default();
    rsx! { svg { class: "icon i-{name}", width: "{size}", height: "{size}", view_box: "0 0 24 24", fill: "none", stroke: "currentColor", stroke_width: "{sw}",
        stroke_linecap: "round", stroke_linejoin: "round", dangerous_inner_html: "{p}" } }
}
/// The 38 px rounded square at the start of a row. tone: alert, warn, info, pos or ink.
#[component]
pub fn Ic(name: String, #[props(default)] tone: String) -> Element {
    rsx! { div { class: "ic ic-{tone}", Icon { name: name.clone(), size: 20.0 } } }
}
/// The dot icon of a dated event: in, out, bill or a statement closing.
#[component]
pub fn DotIc(kind: String) -> Element {
    let name = match kind.as_str() { "in" => "arrowIn", "out" => "arrowOut", "stmt" => "calendar", _ => "card" };
    rsx! { div { class: "ic dot-{kind}", Icon { name: name.to_string(), size: 18.0 } } }
}

/* ---------------- layout ---------------- */
/// A panel: a grey tray (kind "tray"), a white card ("w") or a dark card ("d"), with a title and an optional ⓘ.
#[component]
pub fn Panel(#[props(default)] title: String, #[props(default = "tray".to_string())] kind: String, #[props(default)] info: Option<String>,
    #[props(default)] right: Option<Element>, #[props(default)] i: usize, children: Element) -> Element {
    rsx! {
        section { class: "panel k-{kind} rise", style: "--i:{i}",
            if !title.is_empty() || right.is_some() {
                div { class: "panel-head",
                    h2 { "{title}" }
                    if let Some(sheet) = info.clone() { button { class: "ib", aria_label: "About {title}", onclick: move |_| *SHEET.write() = Some(sheet.clone()), Icon { name: "info".to_string(), size: 18.0 } } }
                    div { class: "grow" }
                    {right}
                }
            }
            {children}
        }
    }
}
/// A row: icon, a title (2 lines at most) with one line of detail, and an amount that never wraps.
#[component]
pub fn Row(#[props(default)] icon: Option<Element>, title: String, #[props(default)] detail: String, #[props(default)] value: Option<String>,
    #[props(default)] sub: String, #[props(default)] tone: String, #[props(default)] soft: bool, #[props(default)] chevron: bool, #[props(default)] total: bool,
    #[props(default)] onclick: Option<EventHandler<MouseEvent>>) -> Element {
    let cls = format!("row{}{}{}", if onclick.is_some() { " press" } else { "" }, if soft { " soft" } else { "" }, if total { " total" } else { "" });
    let vcls = format!("r-val {}", if soft && tone.is_empty() { "t-soft2" } else { tone_class(&tone) });
    let body = rsx! {
        {icon}
        div { class: "r-main",
            div { class: "r-title", "{title}" }
            if !detail.is_empty() { div { class: "r-detail", "{detail}" } }
        }
        if let Some(v) = value.clone() {
            div { class: "r-right",
                div { class: "{vcls}", {shown(&v)} }
                if !sub.is_empty() { div { class: "r-sub", "{sub}" } }
            }
        }
        if chevron { span { class: "chev", Icon { name: "chev".to_string(), size: 18.0 } } }
    };
    match onclick {
        Some(h) => rsx! { button { class: "{cls}", onclick: move |e| h.call(e), {body} } },
        None => rsx! { div { class: "{cls}", {body} } },
    }
}
#[component]
pub fn DayHead(left: String, #[props(default)] right: String) -> Element {
    rsx! { div { class: "dayhead", span { class: "dh-l", "{left}" } if !right.is_empty() { span { class: "dh-r", "{right}" } } } }
}
#[component]
pub fn Note(children: Element, #[props(default)] tone: String) -> Element { rsx! { p { class: "note {tone_class(&tone)}", {children} } } }
/// A tile: a label, a figure and one line under it.
#[component]
pub fn Tile(label: String, value: String, #[props(default)] sub: String, #[props(default)] tone: String, #[props(default)] onclick: Option<EventHandler<MouseEvent>>) -> Element {
    let body = rsx! { div { class: "t-label", "{label}" } div { class: "t-val {tone_class(&tone)}", {shown(&value)} } if !sub.is_empty() { div { class: "t-sub", "{sub}" } } };
    match onclick { Some(h) => rsx! { button { class: "tile press", onclick: move |e| h.call(e), {body} } }, None => rsx! { div { class: "tile", {body} } } }
}
/// A button: "solid", "ghost" or "link".
#[component]
pub fn Btn(label: String, #[props(default = "solid".to_string())] kind: String, #[props(default)] small: bool, onclick: EventHandler<MouseEvent>) -> Element {
    let cls = format!("btn b-{}{}", kind, if small { " small" } else { "" });
    rsx! { button { class: "{cls}", onclick: move |e| onclick.call(e), "{label}" } }
}

/* ---------------- the rolling figure ---------------- */
/// "₹14,080" where each digit rolls up to its place: a CSS transition on each column, so it always lands on the right
/// digit, and each column is as wide as its digit (the current app's Odo on the web).
#[component]
pub fn Odo(value: f64, #[props(default = "odo".to_string())] class: String) -> Element {
    let text = rup(value);
    let hidden = *HIDDEN.read();
    let mut k = 0usize;
    let cols: Vec<(usize, char)> = text.chars().map(|c| { let i = if c.is_ascii_digit() { k += 1; k - 1 } else { usize::MAX }; (i, c) }).collect();
    let n = cols.len();
    rsx! {
        div { class: "{class}", aria_label: "{text}",
            if hidden { span { class: "odo-ch", "₹••••" } } else {
                for (j, (i, c)) in cols.into_iter().enumerate() {
                    if i == usize::MAX { span { key: "{j}-{n}", class: "odo-ch", "{c}" } } else {
                        OdoDigit { key: "{j}-{n}", d: c.to_digit(10).unwrap() as i32, k: i }
                    }
                }
            }
        }
    }
}
#[component]
fn OdoDigit(d: i32, k: usize) -> Element {
    let mut at = use_signal(|| 0);
    use_effect(move || {
        let target = d;
        spawn(async move { gloo_timers::future::TimeoutFuture::new(40).await; at.set(target); });
    });
    let y = at() as f64;
    rsx! {
        span { class: "odo-col",
            span { class: "odo-size", "{d}" }
            span { class: "odo-strip", style: "transform: translateY(calc(-{y} * var(--lh))); transition-delay: {120 + k * 45}ms",
                for n in 0..10 { span { "{n}" } }
            }
        }
    }
}
