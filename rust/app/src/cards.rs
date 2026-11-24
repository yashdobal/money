//! Cards (rn/src/screens/Cards.js): payments that need their card, all cards at a glance, the best card to use today,
//! then each card: its face, the one line that matters, the billing cycle as a timeline with today on it, the limit
//! in use, and what's been spent since the statement by category. And the card sheets: record a payment, payments,
//! the limit, the statement total.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::{CardState, Engine};
use money_core::fmt::round;
use money_core::time::{self, Ms, DAY};
use serde_json::Value;

/// Card faces: eight deep colours, so no two of your cards look alike. Each card gets the one its bank or name suggests
/// (Regalia Gold gold, a metal card graphite, Axis burgundy, HDFC ocean …), and if another card already has it, the
/// next free one. A face picked in the card's profile (0–3: steel, teal, gold, rose) still wins.
const FACES: [([&str; 3], &str); 8] = [
    (["#2E3F70", "#1C284B", "#0E152B"], "#F2F5FC"),   // 0 sapphire
    (["#1E5A4F", "#143C35", "#0A1F1B"], "#EEF7F4"),   // 1 emerald
    (["#8C6B32", "#5E471F", "#2F230E"], "#FBF3E1"),   // 2 gold
    (["#6E2438", "#4A1725", "#260B13"], "#FCEEF1"),   // 3 burgundy
    (["#46494F", "#292B2F", "#151618"], "#F5F5F3"),   // 4 graphite
    (["#4A3580", "#302254", "#180F2B"], "#F3EFFC"),   // 5 violet
    (["#83421F", "#582C14", "#2C150A"], "#FCEFE7"),   // 6 copper
    (["#1D5675", "#13394E", "#0A1D28"], "#EAF5FB"),   // 7 ocean
];
/// The face each card account gets (see FACES).
fn face_map(e: &Engine) -> std::collections::HashMap<String, usize> {
    let mut out = std::collections::HashMap::new();
    let mut used = [false; 8];
    for k in &e.group_order {
        let p = e.profile.get("groups").and_then(|g| g.get(k));
        let picked = p.and_then(|p| p.get("face")).and_then(|v| v.as_f64()).filter(|f| *f >= 0.0 && *f < 4.0).map(|f| [4, 1, 2, 3][f as usize]);
        let g = e.groups.get(k);
        let text = format!("{} {} {} {}", k, g.map(|g| g.short.as_str()).unwrap_or(""), g.map(|g| g.sub.as_str()).unwrap_or(""), g.map(|g| g.issuer.as_str()).unwrap_or("")).to_lowercase();
        let has = |w: &[&str]| w.iter().any(|x| text.contains(x));
        let brand = if has(&["gold"]) { 2 } else if has(&["aurum", "metal", "black", "infinia", "reserve", "magnus", "onecard"]) { 4 }
            else if has(&["amazon"]) { 0 } else if has(&["axis", "kotak", "idfc", "indusind"]) { 3 } else if has(&["hsbc", "icici"]) { 6 }
            else if has(&["hdfc", "yes"]) { 7 } else if has(&["sbi"]) { 0 } else if has(&["tata", "neu", "flipkart", "au "]) { 5 } else { 0 };
        let f = picked.unwrap_or_else(|| if !used[brand] { brand } else { [0, 1, 2, 3, 5, 6, 7, 4].into_iter().find(|i| !used[*i]).unwrap_or(brand) });
        used[f] = true;
        out.insert(k.clone(), f);
    }
    out
}
/// Which card to bring into view when Cards opens (from elsewhere).
pub static FOCUS: GlobalSignal<Option<String>> = Signal::global(|| None);

fn limit_of(e: &Engine, g: &str) -> Option<f64> { e.overrides.get(&format!("limit|{}", g)).and_then(|v| v.as_f64()) }
/// Where a card stands: owe, overdue, the due date that matters, and the badge (words, tone).
struct Standing { owe: bool, overdue: bool, due: Ms, badge: (String, &'static str) }
fn standing(c: &CardState) -> Standing {
    let owe = !c.pre_first && c.billed_left >= 0.5;
    let overdue = owe && c.due_in < 0;
    let due = if c.prev_unpaid >= 0.5 { c.c.prev_due } else { c.c.due };
    let badge = if c.pre_first { ("No bill yet".into(), "") } else if c.billed < 0.5 && c.prev_unpaid < 0.5 { ("Nothing billed".into(), "pos") } else if !owe { ("Paid".into(), "pos") }
        else if overdue { ("Overdue".into(), "alert") }
        else { (match c.due_in { 0 => "Due today".into(), 1 => "Due tomorrow".into(), n => format!("Due in {} days", n) }, if c.due_in <= 3 { "alert" } else if c.due_in <= 5 { "warn" } else { "" }) };
    Standing { owe, overdue, due, badge }
}
/// Spend today and you pay it on the next statement's due date: the days in between.
fn float_days(today: Ms, c: &CardState) -> i32 { time::days(today, c.c.next_due) }
fn carrying(c: &CardState) -> bool { c.prev_unpaid >= 0.5 || (!c.pre_first && c.billed_left >= 0.5 && c.due_in < 0) }
fn scroll_to(id: &str) {
    if let Some(el) = web_sys::window().and_then(|w| w.document()).and_then(|d| d.get_element_by_id(id)) {
        let o = web_sys::ScrollIntoViewOptions::new();
        o.set_behavior(web_sys::ScrollBehavior::Smooth);
        o.set_block(web_sys::ScrollLogicalPosition::Start);
        el.scroll_into_view_with_scroll_into_view_options(&o);
    }
}

#[component]
pub fn Cards() -> Element {
    let _ = VER();
    let (cards, un, today) = eng(|e| {
        let now = e.now();
        (e.all_cards(), e.pay_info.unresolved.iter().filter(|t| t.ts > now - 60 * DAY).cloned().collect::<Vec<_>>(), e.today())
    });
    use_effect(move || {
        if let Some(k) = FOCUS() {
            spawn(async move { gloo_timers::future::TimeoutFuture::new(450).await; scroll_to(&format!("card-{}", k)); *FOCUS.write() = None; });
        }
    });
    let n_un = un.len();
    let base = if n_un > 0 { 1 } else { 0 };
    let ncards = cards.len();
    rsx! {
        div { class: "page",
            if n_un > 0 {
                Panel { title: if n_un == 1 { "A card payment needs its card".to_string() } else { format!("{} card payments need their card", n_un) }, i: 0,
                    Note { "These left your bank like a card bill, but no confirmation email said which card. Pick one." }
                    for t in un.iter().rev().take(5).rev().cloned() {
                        div { key: "{t.id}", style: "margin-top:8px",
                            div { class: "rows", Row { icon: rsx! { CatIc { cat: "Card payment" } }, title: t.desc.clone(), detail: format!("{} {}", time::fmt(t.ts), time::year(t.ts)), value: exact_s(t.amt, "") } }
                            div { class: "chips", style: "margin-top:8px",
                                for (k, name) in eng(|e| e.open_groups(Some(t.ts)).into_iter().map(|k| (k.clone(), e.card_short(&k))).collect::<Vec<_>>()) {
                                    Chip { key: "{k}", small: true, label: name.clone(), onclick: { let (id, k, name) = (t.id.clone(), k.clone(), name.clone()); move |_| { act(|e| e.assign_payment(&id, &k)); toast(format!("Matched to {}", name), ""); } } }
                                }
                                Chip { small: true, dashed: true, label: "Not a card payment", onclick: { let id = t.id.clone(); move |_| { act(|e| e.assign_payment(&id, "none")); toast("Marked as not a card payment", ""); } } }
                            }
                        }
                    }
                }
            }
            if ncards > 0 { Summary { cards: cards.clone(), i: base } }
            if ncards > 1 { BestToday { cards: cards.clone(), today, i: base + 1 } }
            for (i, c) in cards.into_iter().enumerate() {
                div { key: "{c.key}", id: format!("card-{}", c.key), class: "cardblock", CardBlock { c: c.clone(), i, today } }
            }
            if ncards == 0 { Panel { kind: "w", Note { "No cards yet. Add your cards under Settings → Your banks and cards." } } }
        }
    }
}

/// All cards at a glance: what's to pay, which is next, and (with limits) how much of them you're using.
#[component]
fn Summary(cards: Vec<CardState>, i: usize) -> Element {
    let _ = VER();
    let mut owing: Vec<&CardState> = cards.iter().filter(|c| !c.pre_first && c.billed_left >= 0.5).collect();
    owing.sort_by_key(|c| c.due_in);
    let to_pay: f64 = owing.iter().map(|c| c.billed_left).sum();
    let since: f64 = cards.iter().map(|c| c.unbilled_left).sum();
    let lims: Vec<(f64, f64)> = eng(|e| cards.iter().filter_map(|c| limit_of(e, &c.key).map(|l| (c.owed, l))).collect());
    let used: f64 = lims.iter().map(|x| x.0).sum();
    let cap: f64 = lims.iter().map(|x| x.1).sum();
    let pct = if cap > 0.0 { Some(round(used / cap * 100.0) as i64) } else { None };
    let late: Vec<&&CardState> = owing.iter().filter(|c| c.due_in < 0).collect();
    let line = if let Some(l) = late.first() { format!("{} is overdue: pay it first.", eng(|e| e.card_short(&l.key))) }
        else if let Some(n) = owing.first() { format!("Next: {}, {} ({})", eng(|e| e.card_short(&n.key)), match n.due_in { 0 => "due today".into(), 1 => "due tomorrow".into(), d => format!("due in {} days", d) }, time::fmt(n.c.due)) }
        else { "Nothing due until the next statements close.".into() };
    let first = cards[0].key.clone();
    let (ptone, psub) = match pct { None => ("", "to see how much you use".to_string()), Some(p) => (if p <= 30 { "pos" } else if p <= 90 { "warn" } else { "alert" },
        if lims.len() < cards.len() { "of the cards with a limit".into() } else { "under 30% is the usual advice".into() }) };
    rsx! {
        Panel { kind: "w", i,
            div { class: "small2", if owing.is_empty() { "Card bills" } else { {format!("To pay on {}", plural(owing.len() as i64, "bill"))} } }
            if owing.is_empty() { div { class: "allpaid", "All paid ✓" } } else { div { class: if late.is_empty() { "fig" } else { "fig t-alert" }, {shown(&amt(to_pay))} } }
            p { class: if late.is_empty() { "line2" } else { "line2 t-alert" }, "{line}" }
            div { class: "minis",
                div { class: "mini", div { class: "m-l", "Spent since statements" } div { class: "m-v", {shown(&amt(since))} } div { class: "m-s", "on the next bills" } }
                if pct.is_none() {
                    button { class: "mini press", aria_label: "Limit used", onclick: move |_| *SHEET.write() = Some(format!("limit:{}", first)),
                        div { class: "m-l", "Limit used" } div { class: "m-v t-accent", "Add limits" } div { class: "m-s", "{psub}" } }
                } else {
                    div { class: "mini", div { class: "m-l", "Limit used" } div { class: "m-v {tone_class(ptone)}", "{pct.unwrap()}%" } div { class: "m-s", "{psub}" } }
                }
            }
        }
    }
}

/// Which card to use today: the one whose bill you'd pay latest (the most interest-free days).
#[component]
fn BestToday(cards: Vec<CardState>, today: Ms, i: usize) -> Element {
    let _ = VER();
    let mut ok: Vec<(&CardState, i32)> = cards.iter().filter(|c| !carrying(c)).map(|c| (c, float_days(today, c))).collect();
    ok.sort_by(|a, b| b.1.cmp(&a.1));
    if ok.is_empty() { return rsx! {} }
    let (best, d) = ok[0];
    let name = eng(|e| e.card_short(&best.key));
    let rest: Vec<(String, String)> = ok[1..].iter().map(|(c, d)| (c.key.clone(), {
        let s = eng(|e| e.card_short(&c.key));
        let s = regex::Regex::new(r" ·\d+$").unwrap().replace(&s, "").to_string();
        format!("{} · {} days", s, d)
    })).collect();
    rsx! {
        Panel { title: "Best card to use today", kind: "w", info: "about-float", i,
            div { class: "best",
                div { class: "ic ic-pos", Icon { name: "card".to_string() } }
                div { class: "grow",
                    div { class: "best-t", "{name}" }
                    div { class: "best-d", "Spend today, pay by {time::fmt(best.c.next_due)}: {d} days interest-free" }
                }
            }
            if !rest.is_empty() {
                div { class: "chips", style: "margin-top:12px",
                    for (k, label) in rest.into_iter() {
                        Chip { key: "{k}", small: true, label, onclick: move |_| *FOCUS.write() = Some(k.clone()) }
                    }
                }
            }
        }
    }
}

#[component]
fn CardBlock(c: CardState, i: usize, today: Ms) -> Element {
    let _ = VER();
    let st = standing(&c);
    let lim = eng(|e| limit_of(e, &c.key));
    let key = c.key.clone();
    let (k1, k2, k3, k4) = (key.clone(), key.clone(), key.clone(), key.clone());
    let note = Engine::source_note(&c);
    let edit = c.source == "alerts" || c.source == "you";
    rsx! {
        div { class: "deal", style: "--i:{i}", Face { c: c.clone(), badge: st.badge.0.clone(), btone: st.badge.1 } }
        div { class: "panel k-w det", style: "--i:{i}",
            Action { c: c.clone(), today }
            Timeline { c: c.clone(), today }
            if let Some(l) = lim { LimitBar { c: c.clone(), lim: l } }
            ThisCycle { c: c.clone() }
            div { class: "card-acts",
                button { class: if st.owe { "btn small b-solid" } else { "btn small b-ghost" }, onclick: move |_| *SHEET.write() = Some(format!("pay:{}", k1)), "Record payment" }
                button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some(format!("payments:{}", k2)), "Payments" }
                button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some(format!("limit:{}", k3)), if lim.is_some() { "Limit" } else { "Add limit" } }
                if edit { button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some(format!("stmt:{}", k4)), if c.has_override { "Edit bill" } else { "Bill differs?" } } }
            }
            if !c.pre_first { p { class: "src", "Bill {note}." } }
        }
    }
}

/// The one line that matters: what to pay, by when, how long is left (or that it's settled, and what's next).
#[component]
fn Action(c: CardState, today: Ms) -> Element {
    let st = standing(&c);
    let hidden = HIDDEN();
    if st.overdue {
        let late_from = time::add_days(st.due, 3);
        let past3 = time::days(late_from, today) > 0;
        return rsx! {
            div { class: "act-h t-alert", "Pay ", {shown(&amt(c.billed_left))}, " now" }
            div { class: "act-l t-alert", "It was due {time::fmt(st.due)} ({plural(-c.due_in as i64, \"day\")} ago)." }
            p { class: "act-n",
                if past3 { "It's more than 3 days late, so the bank can now charge a late fee and report it to the credit bureaus. Interest runs from each purchase date until it's paid." }
                else { {format!("Banks can charge a late fee or report it only after 3 days past the due date: pay by {} to avoid both. Paid it from somewhere these emails don't cover? Record it.", time::fmt(late_from))} }
            }
        };
    }
    if st.owe {
        let tone = if c.due_in <= 1 { "t-alert" } else if c.due_in <= 5 { "t-warn" } else { "t-soft2" };
        let left = match c.due_in { 0 => "Due today".to_string(), 1 => "1 day left".into(), d => format!("{} days left", d) };
        let paid = if c.to_billed >= 0.5 && !hidden { format!(" · {} of {} paid", exact_s(c.to_billed, ""), exact_s(c.billed, "")) } else { String::new() };
        return rsx! {
            div { class: "act-h", "Pay ", {shown(&amt(c.billed_left))}, " by {time::fmt(st.due)}" }
            div { class: "act-l {tone}", "{left}{paid}" }
            if c.prev_unpaid >= 0.5 { p { class: "act-n t-alert", {format!("Includes {} still unpaid from the {} bill.", if hidden { "an amount".into() } else { exact_s(c.prev_unpaid, "") }, time::fmt(c.c.prev_stmt))} } }
            if let Some(m) = c.min_due.filter(|m| *m != 0.0) { p { class: "act-n t-soft", {format!("Minimum {}. Paying only the minimum keeps the card in good standing, but interest then runs on every purchase and new ones lose their interest-free days.", if hidden { "₹ ••••".into() } else { money_core::fmt::money(m) })} } }
        };
    }
    let head = if c.pre_first { format!("First bill on {}", time::fmt(c.c.next_stmt)) } else if c.billed < 0.5 && c.prev_unpaid < 0.5 { format!("Nothing billed on {}", time::fmt(c.c.stmt)) } else { "Bill paid in full ✓".into() };
    rsx! {
        div { class: if c.pre_first { "act-h" } else { "act-h t-pos" }, "{head}" }
        div { class: "act-l t-soft2", if c.pre_first { {format!("Due {}", time::fmt(c.c.next_due))} } else { {format!("Next bill {}, due {}", time::fmt(c.c.next_stmt), time::fmt(c.c.next_due))} } }
        if c.credit > 0.5 { p { class: "act-n t-pos", {format!("{} paid ahead sits as credit on the card.", if hidden { "Some".into() } else { exact_s(c.credit, "") })} } }
    }
}

/// The billing cycle as a line: this statement → its due date → the next statement → its due date, with today on it.
#[component]
fn Timeline(c: CardState, today: Ms) -> Element {
    let st = standing(&c);
    let a = c.c.stmt.min(st.due) as f64;
    let b = c.c.next_due as f64;
    let x = |d: Ms| ((d as f64 - a) / (b - a) * 100.0).clamp(-2.0, 102.0);
    let tx = x(today).clamp(0.0, 100.0);
    let bill_col = if c.pre_first { "var(--line2)" } else if st.overdue { "var(--alert)" } else if st.owe { if c.due_in <= 5 { "var(--warn)" } else { "var(--ink)" } } else { "var(--pos)" };
    let marks = [
        (c.c.stmt, false, if c.pre_first { "Cycle" } else { "Bill" }, None),
        (st.due, true, if st.owe { "Due" } else { "Was due" }, Some(bill_col)),
        (c.c.next_stmt, false, "Next bill", None),
        (c.c.next_due, true, "Due", None),
    ];
    let (s0, s1) = (x(c.c.stmt).min(x(st.due)), x(c.c.stmt).max(x(st.due)));
    let (n0, n1) = (x(c.c.next_stmt), x(c.c.next_due));
    let fd = float_days(today, &c);
    rsx! {
        div { class: "tl",
            div { class: "tl-track" }
            div { class: "tl-seg", style: "left:{s0}%;width:{s1 - s0}%;background:{bill_col}" }
            div { class: "tl-seg next", style: "left:{n0}%;width:{(n1 - n0).max(0.0)}%" }
            for (k, (d, top, l, col)) in marks.into_iter().enumerate() {
                div { key: "d{k}", class: "tl-dot", style: "left:{x(d)}%;background:{col.unwrap_or(\"var(--ink3)\")}" }
                div { key: "l{k}", class: format!("tl-lab {} {}", if top { "top" } else { "bot" }, if x(d) < 12.0 { "start" } else if x(d) > 88.0 { "end" } else { "mid" }), style: "left:{x(d)}%",
                    span { class: "tl-l", style: if let Some(cc) = col { format!("color:{}", cc) } else { String::new() }, "{l}" } span { class: "tl-s", "{time::fmt(d)}" } }
            }
            div { class: "tl-today", style: "left:{tx}%", i {} b {} }
        }
        div { class: "tl-note",
            i {}
            span { if carrying(&c) { "Today: new spending on this card starts charging interest until the old bill is fully paid." } else { {format!("Today: spend on this card and you pay it by {}, {} days interest-free.", time::fmt(c.c.next_due), fd)} } }
        }
    }
}

/// How much of the limit is in use: billed and unpaid, spent since the statement, and what's left; a mark at 30%.
#[component]
fn LimitBar(c: CardState, lim: f64) -> Element {
    let billed = c.billed_left.max(0.0);
    let since = c.unbilled_left.max(0.0);
    let used = billed + since;
    let pct = round(used / lim * 100.0) as i64;
    let tone = if pct <= 30 { "pos" } else if pct <= 90 { "warn" } else { "alert" };
    let w = |v: f64| (v / lim * 100.0).min(100.0);
    rsx! {
        div { class: "lim",
            div { class: "lim-h", span { class: "lim-t", "Using {pct}% of the limit" } span { class: tone_class(tone), if pct <= 30 { "healthy" } else if pct <= 90 { "above 30%" } else { "near the limit" } } }
            div { class: "lim-bar",
                div { class: "lim-track", i { class: "grow-w", style: "width:{w(billed)}%;background:var(--ink)" } i { class: "grow-w", style: "width:{w(since)}%;background:var(--info)" } }
                b { class: "lim-30" } span { class: "lim-30t", "30%" }
            }
            div { class: "legs",
                span { i { style: "background:var(--ink)" } "billed, unpaid ", {shown(&amt(billed))} }
                span { i { style: "background:var(--info)" } "since the bill ", {shown(&amt(since))} }
                span { i { class: "hollow" } "available ", {shown(&amt((lim - used).max(0.0)))} }
            }
        }
    }
}

fn hue_of(k: &str) -> &'static str { if k == "Everything else" { "var(--line2)" } else { cat_hue(k) } }
/// What's on the card since the statement, by category (top four); tap for the transactions.
#[component]
fn ThisCycle(c: CardState) -> Element {
    let _ = VER();
    let from = if c.pre_first { Ms::MIN } else { c.c.stmt + DAY - 1 };
    let mut by: Vec<(String, f64)> = vec![];
    for x in eng(|e| e.all_tx()) {
        if x.card.as_deref() == Some(c.key.as_str()) && x.t.dir == "out" && x.t.ts > from {
            match by.iter_mut().find(|b| b.0 == x.t.cat) { Some(b) => b.1 += x.t.amt, None => by.push((x.t.cat.clone(), x.t.amt)) }
        }
    }
    if by.is_empty() { return rsx! {} }
    by.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let tot: f64 = by.iter().map(|b| b.1).sum();
    let rest: f64 = by.iter().skip(4).map(|b| b.1).sum();
    let mut top: Vec<(String, f64)> = by.into_iter().take(4).collect();
    if rest > 0.0 { top.push(("Everything else".into(), rest)); }
    let key = c.key.clone();
    let card_name = eng(|e| e.card_short(&key));
    rsx! {
        div { class: "cyc",
            div { class: "cyc-h", span { if c.pre_first { "Spent so far" } else { {format!("Spent since {}", time::fmt(c.c.stmt))} } } b { {shown(&amt(tot))} } }
            div { class: "cyc-bar", for (k, v) in top.iter() { i { key: "{k}", style: format!("flex:{};background:{}", v, hue_of(k)) } } }
            for (k, v) in top.into_iter() {
                button { key: "{k}", class: "cyc-row", aria_label: "{k} on {card_name}",
                    onclick: { let (key, k) = (key.clone(), k.clone()); move |_| show_activity(ActParams { card: key.clone(), cat: if k == "Everything else" { String::new() } else { k.clone() }, ..Default::default() }) },
                    i { style: format!("background:{}", hue_of(&k)) }
                    span { class: "grow", "{k}" }
                    span { class: "cyc-p", "{round(v / tot * 100.0) as i64}%" }
                    span { class: "cyc-v", {shown(&amt(v))} }
                }
            }
        }
    }
}

/// The card itself, 1.586:1: a graphite face with a highlight, faint stripes, a chip, the network; tap for its
/// transactions.
#[component]
fn Face(c: CardState, badge: String, btone: &'static str) -> Element {
    let _ = VER();
    let (i, face, net, nums) = eng(|e| {
        let p = e.profile.get("groups").and_then(|g| g.get(&c.key));
        let i = e.group_order.iter().position(|k| *k == c.key).unwrap_or(0);
        let f = face_map(e).get(&c.key).copied().unwrap_or(i % 8);
        let net = p.and_then(|p| p.get("net")).map(|v| match v { Value::String(s) => s.to_uppercase(), Value::Null => String::new(), x => x.to_string() }).unwrap_or_default();
        let nums = c.members.iter().filter_map(|m| e.card_cfg.get(m).map(|x| x.last4.clone())).collect::<Vec<_>>().join(" · ");
        (i, f, net, nums)
    });
    let _ = i;
    let (g, ink) = FACES[face];
    let paid_pct = if c.billed > 0.0 { (c.to_billed / c.billed * 100.0).min(100.0) } else { 0.0 };
    let name = eng(|e| e.card_short(&c.key));
    let key = c.key.clone();
    let hidden = HIDDEN();
    rsx! {
        button { class: "face", aria_label: "{c.cfg.short}: see its transactions", style: "--g0:{g[0]};--g1:{g[1]};--g2:{g[2]};--fink:{ink}",
            onclick: move |_| show_activity(ActParams { card: key.clone(), ..Default::default() }),
            i { class: "face-sheen" }
            div { class: "face-top", span { class: "face-name", "{name}" } span { class: "badge b-{btone}", "{badge}" } }
            div { class: "face-mid", span { class: "chip-gold" } span { class: "face-nums", "•••• {nums}" } }
            div { class: "face-bot",
                div { class: "face-l", "On the card" }
                div { class: "face-fig", {shown(&amt(c.owed))} }
                div { class: "face-bar", i { style: "width:{paid_pct}%" } }
                div { class: "face-s", if c.billed > 0.0 { if hidden { "••••" } else { {format!("{} of {} paid", amt(c.to_billed), amt(c.billed))} } } else { "nothing billed yet" } }
            }
            span { class: "face-net", "{net}" }
        }
    }
}

/* ---------------- the card sheets ---------------- */
fn close() { *SHEET.write() = None; }

/// Record a payment made from somewhere the emails don't cover.
#[component]
pub fn PaySheet(g: String) -> Element {
    let _ = VER();
    let (c, short, today) = eng(|e| (e.all_cards().into_iter().find(|x| x.key == g), e.groups.get(&g).map(|x| x.short.clone()).unwrap_or_default(), time::iso(e.today())));
    let was = c.as_ref().map(|c| c.billed_left >= 0.5).unwrap_or(false);
    let v0 = if was { format!("{}", round(c.as_ref().unwrap().billed_left * 100.0) / 100.0) } else { String::new() };
    let mut v = use_signal(move || v0.clone());
    let t0 = today.clone();
    let mut d = use_signal(move || t0.clone());
    let (gg, sh) = (g.clone(), short.clone());
    rsx! {
        h2 { class: "sheet-t", "Record a payment" }
        Note { "For {short}, if you paid from somewhere these emails don't cover." }
        Field { label: "Amount (₹)", value: v(), numeric: true, oninput: move |t| v.set(t) }
        Field { label: "Paid on", kind: "date", value: d(), max: today.clone(), oninput: move |t| d.set(t) }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let msg = act(|e| e.add_payment(&gg, &d(), &v()));
            if !msg.is_empty() { return toast(msg, "alert"); }
            let cleared = was && eng(|e| e.all_cards().into_iter().find(|x| x.key == gg).map(|x| x.billed_left < 0.5).unwrap_or(false));
            close();
            toast(if cleared { format!("{} bill paid in full", sh) } else { "Payment recorded".into() }, "");
        }, "Save" } }
    }
}

/// A card's payment history: what's been paid to it and how each was found.
#[component]
pub fn PaymentsSheet(g: String) -> Element {
    let _ = VER();
    let (c, pays, name) = eng(|e| {
        let c = e.all_cards().into_iter().find(|x| x.key == g);
        let p = c.as_ref().map(|c| e.card_payments(c)).unwrap_or_default();
        (c, p, e.card_short(&g))
    });
    let Some(c) = c else { return rsx! {} };
    rsx! {
        h2 { class: "sheet-t", "Payments to {name}" }
        if pays.is_empty() {
            Note { "No payments to this card found yet. Record one if you paid from somewhere these emails don't cover." }
        } else {
            Note { if c.billed >= 0.5 { if HIDDEN() { {format!("Paid towards the {} bill.", time::fmt(c.c.stmt))} } else { {format!("{} paid towards the {} bill.", exact_s(c.to_billed, ""), time::fmt(c.c.stmt))} } } else { "Every payment found for this card." } }
            div { class: "rows plain",
                for (k, (p, how, off, bt)) in pays.into_iter().enumerate() {
                    div { key: "{k}", class: "pay-line",
                        Row { soft: !bt.is_empty(), title: format!("{} {}", time::fmt(p.ts), time::year(p.ts)), detail: [how, off, bt].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · "),
                            value: exact_s(p.amt, ""), tone: "pos" }
                        if p.kind == "inferred" || (p.kind == "confirmed" && p.tx_id.is_some()) {
                            button { class: "xbtn", aria_label: "That bank debit was something else", onclick: { let t = p.tx_id.clone().unwrap_or_default(); move |_| { act(|e| e.not_card_payment(&t)); toast("That debit no longer counts as a card payment", ""); } },
                                Icon { name: "close".to_string(), size: 16.0 } }
                        } else if p.kind == "manual" {
                            button { class: "xbtn", aria_label: "Remove payment", onclick: { let id = p.id.clone(); move |_| { act(|e| e.del_payment(&id)); toast("Payment removed", ""); } },
                                Icon { name: "close".to_string(), size: 16.0 } }
                        }
                    }
                }
            }
        }
    }
}

/// The card's credit limit (saved with your settings, so every device sees it).
#[component]
pub fn LimitSheet(g: String) -> Element {
    let _ = VER();
    let (have, short) = eng(|e| (limit_of(e, &g), e.groups.get(&g).map(|x| x.short.clone()).unwrap_or_default()));
    let mut v = use_signal(move || have.map(|h| format!("{}", h)).unwrap_or_default());
    let add_on = short.to_lowercase().contains("add-on");
    let k = format!("limit|{}", g);
    let k2 = k.clone();
    rsx! {
        h2 { class: "sheet-t", "Credit limit" }
        Note { {format!("The credit limit on {}, from the bank's app or statement. It shows how much of it you're using; banks and credit bureaus look at that, and under 30% is the usual advice.{}", short,
            if add_on { " On an add-on card the limit is shared with the main card, so enter the limit you see on yours." } else { "" })} }
        Field { label: "Credit limit (₹)", value: v(), numeric: true, oninput: move |t| v.set(t) }
        div { class: "actions",
            if have.is_some() { button { class: "btn b-ghost big", onclick: move |_| { act(|e| e.set_override(&k2, None)); close(); toast("Limit removed", ""); }, "Remove" } }
            button { class: "btn b-solid big", onclick: move |_| {
                let n = money_core::engine::parse_float(&v());
                if !(n >= 1000.0) || n > 1e8 { return toast("Enter the limit in rupees, like 200000.", "alert"); }
                act(|e| e.set_override(&k, Some(Value::from(round(n) as i64)))); close(); toast("Limit saved", "");
            }, "Save" }
        }
    }
}

/// The statement's total due, when the bank's statement says something other than the alerts.
#[component]
pub fn StmtSheet(g: String) -> Element {
    let _ = VER();
    let c = eng(|e| e.all_cards().into_iter().find(|x| x.key == g));
    let Some(c) = c else { return rsx! {} };
    let v0 = if c.has_override { format!("{}", c.billed) } else { String::new() };
    let mut v = use_signal(move || v0.clone());
    let (ok1, ok2) = (c.okey.clone(), c.okey.clone());
    rsx! {
        h2 { class: "sheet-t", "Statement total" }
        Note { {format!("Alerts added up to {} for the {} statement. If the bank's statement says otherwise, enter its total due.", shown(&exact_s(c.billed_alerts, "")), time::fmt(c.c.stmt))} }
        Field { label: "Statement total (₹)", value: v(), numeric: true, oninput: move |t| v.set(t) }
        div { class: "actions",
            if c.has_override { button { class: "btn b-ghost big", onclick: move |_| { act(|e| e.clear_statement(&ok1)); close(); }, "Use alerts instead" } }
            button { class: "btn b-solid big", onclick: move |_| { let m = act(|e| e.set_statement(&ok2, &v())); if !m.is_empty() { return toast(m, "alert"); } close(); toast("Saved", ""); }, "Save" }
        }
    }
}
