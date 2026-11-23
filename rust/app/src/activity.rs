//! Activity: search, filters, every transaction (rn/src/screens/Activity.js), and the Add button.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::{Engine, Row as Tx};
use money_core::time;

const FILTERS: [(&str, &str); 6] = [("all", "All"), ("out", "Money out"), ("in", "Money in"), ("cards", "Cards"), ("bank", "Bank"), ("edited", "Edited by you")];

/// The transactions Activity shows for these filters and this search.
pub fn tx_matches(e: &Engine, p: &ActParams, q: &str) -> Vec<Tx> {
    let f = if p.f.is_empty() { "all" } else { p.f.as_str() };
    let q = q.trim().to_lowercase();
    let num: String = q.chars().filter(|c| !matches!(c, '₹' | ',') && !c.is_whitespace()).collect();
    let num_ok = !num.is_empty() && { let mut it = num.splitn(2, '.'); let a = it.next().unwrap(); let b = it.next(); !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.map(|b| !b.is_empty() && b.chars().all(|c| c.is_ascii_digit())).unwrap_or(true) };
    let dd = if p.d.is_empty() { None } else { time::parse_iso(&p.d) };
    e.all_tx().into_iter().filter(|x| {
        let t = &x.t;
        match f {
            "out" if t.dir != "out" => return false,
            "in" if t.dir != "in" => return false,
            "cards" if t.kind != "card" => return false,
            "bank" if t.kind != "bank" || x.man => return false,
            "edited" if !(x.man || x.noted || x.ruled || x.reversed || x.refunded.is_some() || t.refund_of.is_some()) => return false,
            _ => {}
        }
        if !p.cat.is_empty() && t.cat != p.cat { return false; }
        if !p.card.is_empty() && x.card.as_deref() != Some(p.card.as_str()) { return false; }
        if !p.acct.is_empty() && t.account != p.acct { return false; }
        if !p.m.is_empty() && t.ym != p.m { return false; }
        if let Some(d) = dd { if !(t.ym == time::ym_of(d) && t.day == time::date(d)) { return false; } }
        if !q.is_empty() {
            let hay = format!("{} {} {} {}", t.desc, t.cat, x.note.clone().unwrap_or_default(), t.account).to_lowercase();
            let amt_hit = num_ok && (format!("{}", money_core::fmt::round(t.amt) as i64).contains(&num) || format!("{:.2}", t.amt).contains(&num));
            if !hay.contains(&q) && !amt_hit { return false; }
        }
        true
    }).collect()
}

/// Where a payment was made, short: the card's account, or the bank's name.
pub fn acct_short(e: &Engine, x: &Tx) -> String {
    if let Some(c) = &x.card { return e.card_short(c); }
    e.bank_of(&x.t.account).map(|b| b.name.clone()).unwrap_or_else(|| x.t.account.clone())
}

/// One transaction as a row: payee, where and what, and anything you changed about it.
#[component]
pub fn TxRow(x: Tx) -> Element {
    let _ = VER();
    let (title, extra) = nice(&x.t.desc);
    let mut bits = vec![eng(|e| acct_short(e, &x))];
    if x.t.cat == "Card payment" {
        bits.push(match (&x.pay_other, &x.pay_card) {
            (Some(o), _) => format!("card ·{} (not tracked)", o),
            (None, Some(c)) => format!("paid {}{}", eng(|e| e.card_short(c)), if x.pay_confirmed { ", confirmed" } else { "" }),
            _ => "which card?".into(),
        });
    } else { bits.push(x.t.cat.clone()); }
    if x.t.sms { bits.push("from SMS".into()); }
    if x.reversed { bits.push("reversed, not counted".into()); }
    else if let Some(r) = &x.refunded { bits.push(format!("refunded {}", time::parse_iso(r).map(time::fmt).unwrap_or_default())); }
    else if x.t.refund_of.is_some() { bits.push("refund you marked".into()); }
    else if x.for_other { bits.push("for someone else".into()); }
    else if x.paid_back { bits.push("comes off spending".into()); }
    else if !x.t.counted && x.t.dir == "out" { bits.push("not counted".into()); }
    if !extra.is_empty() { bits.push(extra); }
    if let Some(n) = &x.note { bits.push(format!("“{}”", n)); }
    let inn = x.t.dir == "in";
    let cat = if inn && x.t.cat == "Money in" { "Money in".to_string() } else { x.t.cat.clone() };
    let id = x.t.id.clone();
    let uncounted = !(x.t.counted || inn);
    rsx! {
        Row { icon: rsx! { CatIc { cat } }, title, detail: bits.join(" · "), value: amt_s(x.t.amt, if inn { "in" } else { "out" }), tone: if inn { "pos".to_string() } else { String::new() },
            sub: Engine::clock_of(x.t.ts), uncounted, onclick: move |_| *SHEET.write() = Some(format!("tx:{}", id)) }
    }
}

#[component]
pub fn Activity() -> Element {
    let _ = VER();
    let p = ACT();
    let mut q = use_signal(|| p.q.clone());
    let mut shown = use_signal(|| 60usize);
    let mut seen = use_signal(|| p.seq);
    if p.seq != seen() { seen.set(p.seq); q.set(p.q.clone()); shown.set(60); }
    let list = eng(|e| tx_matches(e, &p, &q()));
    let n = list.len();
    let slice: Vec<Tx> = list.iter().take(shown()).cloned().collect();
    let today = eng(|e| e.today());
    let hidden = HIDDEN();
    // the day headings: the day, and what you spent that day (of what's shown)
    let mut items: Vec<(String, String, Vec<Tx>)> = vec![];
    for x in slice {
        let key = format!("{}-{}", x.t.ym, x.t.day);
        if items.last().map(|i| i.0 != key).unwrap_or(true) { items.push((key, String::new(), vec![])); }
        items.last_mut().unwrap().2.push(x);
    }
    for it in items.iter_mut() {
        let x = &it.2[0];
        let d = { let (y, m) = time::ym_parts(&x.t.ym); time::local(y, m - 1, x.t.day) };
        let same: Vec<Tx> = list.iter().filter(|t| t.t.ym == x.t.ym && t.t.day == x.t.day).cloned().collect();
        let total = eng(|e| e.spend_of(&same).spend);
        let left = format!("{}{}", day_name(today, d), if time::days(d, today).abs() > 1 { String::new() } else { format!(" · {}", time::fmt(d)) });
        let right = if total >= 0.5 { format!("{} spent", if hidden { "••••".into() } else { amt(total) }) } else { String::new() };
        it.1 = format!("{}\u{1}{}", left, right);
    }
    let mut active: Vec<(&'static str, String)> = vec![];
    if !p.cat.is_empty() { active.push(("cat", p.cat.clone())); }
    if !p.card.is_empty() { active.push(("card", eng(|e| e.card_short(&p.card)))); }
    if !p.acct.is_empty() { active.push(("acct", p.acct.clone())); }
    if !p.m.is_empty() { active.push(("m", time::ym_name(&p.m))); }
    if !p.d.is_empty() { active.push(("d", time::parse_iso(&p.d).map(|d| day_name(today, d)).unwrap_or_default())); }
    let data_in = eng(|e| e.data_in);
    let more = n.saturating_sub(shown());
    rsx! {
        div { class: "page",
            div { class: "search rise", style: "--i:0",
                Icon { name: "search".to_string(), size: 19.0 }
                input { r#type: "text", enterkeyhint: "search", placeholder: "Search payee, category, amount or note", aria_label: "Search transactions", value: "{q}",
                    oninput: move |e| { q.set(e.value()); shown.set(60); } }
                if !q().is_empty() { button { class: "ib", aria_label: "Clear the search", onclick: move |_| q.set(String::new()), Icon { name: "close".to_string(), size: 16.0 } } }
            }
            div { class: "rise", style: "--i:1;margin-bottom:6px",
                Chips { scroll: true, small: true, value: if p.f.is_empty() { "all".to_string() } else { p.f.clone() },
                    options: FILTERS.iter().map(|(v, l)| opt(v, l)).collect::<Vec<_>>(),
                    onchange: move |v: String| { shown.set(60); ACT.write().f = if v == "all" { String::new() } else { v }; } }
            }
            if !active.is_empty() {
                div { class: "active-f",
                    for (k, v) in active.into_iter() {
                        Chip { key: "{k}", small: true, on: true, removable: true, label: v.clone(), onclick: move |_| {
                            shown.set(60);
                            let mut a = ACT.write();
                            match k { "cat" => a.cat.clear(), "card" => a.card.clear(), "acct" => a.acct.clear(), "m" => a.m.clear(), _ => a.d.clear() }
                        } }
                    }
                }
            }
            section { class: "panel k-tray rise", style: "--i:3",
                if n == 0 {
                    p { class: "note", style: "padding:24px 0;text-align:center", if data_in { "Nothing matches." } else { "Loading…" } }
                } else {
                    div { class: "rows",
                        for (key, head, rows) in items.into_iter() {
                            DayHead { key: "h{key}", left: head.split('\u{1}').next().unwrap_or("").to_string(), right: head.split('\u{1}').nth(1).unwrap_or("").to_string() }
                            for x in rows.into_iter() { TxRow { key: "{x.t.id}", x } }
                        }
                    }
                }
                if more > 0 {
                    button { class: "btn b-ghost big", style: "margin-top:10px", onclick: move |_| shown.set(shown() + 120), "Show {more.min(120)} more of {n}" }
                }
            }
        }
    }
}

/// "Add" on Activity, springing up out of the dock (outside the page, which moves).
#[component]
pub fn Fab() -> Element {
    rsx! {
        button { class: "fab", aria_label: "Add a payment", onclick: move |_| *SHEET.write() = Some("add".into()),
            Icon { name: "plus".to_string(), size: 22.0, sw: 2.2 } span { "Add" }
        }
    }
}
