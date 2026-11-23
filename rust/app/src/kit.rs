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
        // keys are bare words or "quoted" (the category names)
        let re = Regex::new(r#"^\s+(?:"([^"]+)"|(\w+)):\s*'(.*)',?\s*$"#).unwrap();
        include_str!("../../../rn/src/icon-paths.js").lines().filter_map(|l| re.captures(l).map(|c| (c.get(1).or(c.get(2)).unwrap().as_str().to_string(), c[3].to_string()))).collect()
    })
}
#[component]
pub fn Icon(name: String, #[props(default = 20.0)] size: f64, #[props(default = 1.7)] sw: f64) -> Element {
    // a name it doesn't know (a category of your own) draws "Other"
    let p = icons().get(&name).or_else(|| icons().get("Other")).cloned().unwrap_or_default();
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
    #[props(default)] uncounted: bool, #[props(default)] onclick: Option<EventHandler<MouseEvent>>) -> Element {
    let cls = format!("row{}{}{}{}", if onclick.is_some() { " press" } else { "" }, if soft { " soft" } else { "" }, if total { " total" } else { "" }, if uncounted { " uncounted" } else { "" });
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

/* ---------------- words ---------------- */
/// A payee as a title: "AMAZON WEB SERVICES (USD 24.85 at Rs 86.44)" → ("Amazon Web Services", "USD 24.85 at ₹86.44").
pub fn nice(desc: &str) -> (String, String) {
    static PRE: OnceLock<Regex> = OnceLock::new();
    static FX: OnceLock<Regex> = OnceLock::new();
    static CAPS: OnceLock<Regex> = OnceLock::new();
    let pre = PRE.get_or_init(|| Regex::new(r"(?i)^(NEFT|IMPS|RTGS)(\s+(CR|DR))?[\s\-/:]+").unwrap());
    let fx = FX.get_or_init(|| Regex::new(r"(?i)^(.*?)\s*\(([A-Z]{3})\s+([\d.,]+)\s+at\s+Rs\.?\s*([\d.,]+)\)\s*$").unwrap());
    let caps = CAPS.get_or_init(|| Regex::new(r"[A-Z]{3}").unwrap());
    let mut t = pre.replace(desc.trim(), "").to_string();
    let mut extra = String::new();
    if let Some(c) = fx.captures(&t.clone()) { extra = format!("{} {} at ₹{}", c[2].to_uppercase(), &c[3], &c[4]); t = c[1].to_string(); }
    if t.chars().count() > 4 && t == t.to_uppercase() && caps.is_match(&t) {
        let mut out = String::new(); let mut start = true;
        for ch in t.to_lowercase().chars() { if start && ch.is_ascii_lowercase() { out.extend(ch.to_uppercase()); } else { out.push(ch); } start = !ch.is_alphanumeric() && ch != '_'; }
        t = out;
    }
    (if t.is_empty() { desc.to_string() } else { t }, extra)
}
pub fn cap(t: &str) -> String { let mut c = t.chars(); match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() } }
/// Category colours (muted), as kit.js CAT_C.
pub fn cat_hue(c: &str) -> &'static str {
    match c {
        "Food & dining" => "#B08968", "Groceries" => "#7F9C7A", "Travel" => "#7A93A8", "Shopping" => "#A88595", "Bills & subscriptions" => "#8A86A8",
        "Entertainment" => "#9A8AAE", "Health" => "#7FA3A0", "Transfers to people" => "#A08F80", "Investments" => "#7E9A8E", "Cash & transfers" => "#8F8F94",
        "Card payment" => "#8F8F94", "Moved to goals" => "#7A93A8", "Planned payment" => "#A08F80", "Money in" | "Refunds" | "Paid back" | "Salary" | "Other income" => "#6F9A82",
        _ => "#9A9A9A",
    }
}
/// The icon a category is drawn with.
pub fn cat_icon(c: &str) -> String { match c { "Salary" => "salary".into(), "Other income" => "Money in".into(), c => c.into() } }
/// The row icon for a category.
#[component]
pub fn CatIc(cat: String, #[props(default)] big: bool) -> Element {
    rsx! { div { class: if big { "ic big" } else { "ic" }, Icon { name: cat_icon(&cat), size: if big { 22.0 } else { 20.0 } } } }
}
#[component]
pub fn SubHead(text: String) -> Element { rsx! { h3 { class: "sub-h", "{text}" } } }

/* ---------------- choices ---------------- */
/// A chip: a single choice you tap. A white pill on grey, dark when chosen.
#[component]
pub fn Chip(label: String, #[props(default)] on: bool, #[props(default)] icon: String, #[props(default)] hue: String, #[props(default)] small: bool,
    #[props(default)] removable: bool, #[props(default)] dashed: bool, onclick: EventHandler<MouseEvent>) -> Element {
    let cls = format!("chip{}{}{}", if on { " on" } else { "" }, if small { " small" } else { "" }, if dashed { " dashed" } else { "" });
    let style = if !hue.is_empty() && !on { format!("--hue:{}", hue) } else { String::new() };
    rsx! {
        button { class: "{cls}", style: "{style}", role: "radio", aria_checked: "{on}", onclick: move |e| onclick.call(e),
            if !icon.is_empty() { span { class: "chip-ic", Icon { name: icon.clone(), size: 16.0 } } }
            span { "{label}" }
            if removable { Icon { name: "close".to_string(), size: 14.0 } }
        }
    }
}
/// One choice among several: (value, label, icon, colour).
#[derive(Clone, PartialEq, Debug, Default)]
pub struct Opt { pub v: String, pub label: String, pub icon: String, pub hue: String }
pub fn opt(v: &str, label: &str) -> Opt { Opt { v: v.into(), label: label.into(), ..Default::default() } }
pub fn cat_opt(c: &str) -> Opt { Opt { v: c.into(), label: c.into(), icon: cat_icon(c), hue: cat_hue(c).into() } }
#[component]
pub fn Chips(options: Vec<Opt>, value: String, onchange: EventHandler<String>, #[props(default)] scroll: bool, #[props(default)] small: bool) -> Element {
    rsx! {
        div { class: if scroll { "chips scroll" } else { "chips" }, role: "radiogroup",
            for o in options.into_iter() {
                Chip { key: "{o.v}", label: o.label.clone(), on: o.v == value, icon: o.icon.clone(), hue: o.hue.clone(), small, onclick: move |_| onchange.call(o.v.clone()) }
            }
        }
    }
}
/// Segmented choices: the highlight slides to the one you pick.
#[component]
pub fn Seg(options: Vec<Opt>, value: String, onchange: EventHandler<String>, #[props(default)] full: bool) -> Element {
    let n = options.len().max(1);
    let at = options.iter().position(|o| o.v == value).unwrap_or(0);
    rsx! {
        div { class: if full { "seg full" } else { "seg" }, role: "radiogroup", style: "--n:{n};--at:{at}",
            div { class: "seg-hl" }
            for o in options.into_iter() {
                button { key: "{o.v}", class: if o.v == value { "seg-o on" } else { "seg-o" }, onclick: move |_| onchange.call(o.v.clone()), "{o.label}" }
            }
        }
    }
}
#[component]
pub fn Switch(on: bool, onchange: EventHandler<bool>, #[props(default)] label: String) -> Element {
    rsx! { button { class: if on { "switch on" } else { "switch" }, role: "switch", aria_checked: "{on}", aria_label: "{label}", onclick: move |_| onchange.call(!on), i {} } }
}
/// A setting row in a sheet: a title, a line of detail, a switch.
#[component]
pub fn SwRow(title: String, #[props(default)] detail: String, on: bool, onchange: EventHandler<bool>) -> Element {
    rsx! {
        div { class: "swrow",
            div { class: "grow", div { class: "sw-t", "{title}" } if !detail.is_empty() { div { class: "sw-d", "{detail}" } } }
            Switch { on, onchange, label: title.clone() }
        }
    }
}
/// A text field with its label; numeric keeps digits and one point.
#[component]
pub fn Field(#[props(default)] label: String, value: String, oninput: EventHandler<String>, #[props(default)] numeric: bool, #[props(default)] placeholder: String,
    #[props(default)] multiline: bool, #[props(default)] error: String, #[props(default)] big: bool, #[props(default)] prefix: String,
    #[props(default)] kind: String, #[props(default)] max: String) -> Element {
    let clean = move |v: String| if numeric {
        let mut seen = false;
        v.chars().filter(|c| c.is_ascii_digit() || (*c == '.' && !std::mem::replace(&mut seen, true))).collect()
    } else { v };
    let cls = format!("fld{}{}", if big { " big" } else { "" }, if error.is_empty() { "" } else { " err" });
    let ty = if kind.is_empty() { "text".to_string() } else { kind.clone() };
    rsx! {
        label { class: "fwrap",
            if !label.is_empty() { span { class: "f-label", "{label}" } }
            div { class: "{cls}",
                if !prefix.is_empty() { span { class: "f-pre", "{prefix}" } }
                if multiline {
                    textarea { value: "{value}", placeholder: "{placeholder}", maxlength: "500", oninput: move |e| oninput.call(clean(e.value())) }
                } else {
                    input { r#type: "{ty}", value: "{value}", placeholder: "{placeholder}", max: "{max}", inputmode: if numeric { "decimal" } else { "text" }, oninput: move |e| oninput.call(clean(e.value())) }
                }
            }
            if !error.is_empty() { span { class: "f-err", "{error}" } }
        }
    }
}

/// The toast along the bottom.
#[component]
pub fn ToastHost() -> Element {
    let Some(t) = crate::state::TOAST() else { return rsx! {} };
    rsx! {
        div { key: "{t.n}", class: "toast t-{t.tone}", role: "status",
            span { class: "grow", "{t.text}" }
            if let Some(id) = t.undo.clone() {
                button { class: "toast-undo", onclick: move |_| { crate::state::act(|e| e.unreverse(&id)); *crate::state::TOAST.write() = None; }, "Undo" }
            }
        }
    }
}
/// An amount to the paisa when it has paise ("₹2,148.00" stays "₹2,148"), with a sign like amt_s.
pub fn exact_s(n: f64, sign: &str) -> String {
    let v = n.abs();
    let c = (v * 100.0).round() as u64;
    let body = if c % 100 != 0 { format!("₹{}.{:02}", group_in(c / 100), c % 100) } else { rup(v) };
    let s = match sign { "out" if v >= 0.5 => "−", "in" if v >= 0.5 => "+", _ => "" };
    format!("{}{}", s, body)
}
