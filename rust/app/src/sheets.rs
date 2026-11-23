//! Sheets: "How this is worked out", "Where you stand", the bank balance history, and the ⓘ notes.

use crate::kit::*;
use crate::state::{eng, VER};
use crate::today::BankChart;
use dioxus::prelude::*;
use money_core::time;

#[component]
pub fn SheetBody(name: String) -> Element {
    let _ = VER();
    match name.as_str() {
        "explain" => rsx! { Explain {} },
        "add" => rsx! { crate::txsheets::AddSheet {} },
        "salary" => rsx! { crate::plan::SalarySheet {} },
        "fixed" => rsx! { crate::plan::FixedSheet {} },
        "goal" => rsx! { crate::plan::GoalSheet {} },
        n if n.starts_with("move:") => rsx! { crate::plan::MoveSheet { key: "{n}", gid: n[5..].to_string() } },
        "about-goals" => rsx! { h2 { class: "sheet-t", "Goals" } Note { "Goal money comes out of your SIP share under your salary rule (before the rule, out of your pay). The emergency fund gets the rule's share until it reaches its limit. Two or three goals work better than many." } },
        n if n.starts_with("pay:") => rsx! { crate::cards::PaySheet { key: "{n}", g: n[4..].to_string() } },
        n if n.starts_with("payments:") => rsx! { crate::cards::PaymentsSheet { key: "{n}", g: n[9..].to_string() } },
        n if n.starts_with("limit:") => rsx! { crate::cards::LimitSheet { key: "{n}", g: n[6..].to_string() } },
        n if n.starts_with("stmt:") => rsx! { crate::cards::StmtSheet { key: "{n}", g: n[5..].to_string() } },
        "about-float" => rsx! { h2 { class: "sheet-t", "Best card to use today" } Note { "Spend on a card today and it lands on that card's next statement, so you pay it on that statement's due date. The card whose statement closed most recently gives the longest wait, all of it interest-free as long as every bill is paid in full by its due date. Cards with an unpaid bill past its due date are left out: new spending on them is charged interest until that bill is cleared. Under RBI rules you can ask your bank to move a card's billing cycle (at least once), for example so every bill falls due just after payday." } },
        n if n.starts_with("tx:") => rsx! { crate::txsheets::TxSheet { key: "{n}", id: n[3..].to_string() } },
        "net" => rsx! { NetSheet {} },
        "bank" => rsx! { History {} },
        "about-coming" => rsx! { h2 { class: "sheet-t", "Coming up" } Note { "Every dated thing from today on: card bills and statements, card EMIs, your salary and what it sends to family, SIP and the emergency fund, and fixed payments. Grey ones are information (a statement closing, a charge on a card), not money leaving your bank that day." } },
        "about-usual" => rsx! { h2 { class: "sheet-t", "A usual month" } Note { "Your take-home pay split by your salary rule, with no one-off payments: what goes to family, the SIP and the emergency fund, and what's yours to spend." } },
        _ => rsx! { h2 { class: "sheet-t", "Not in the Rust app yet" } Note { "This part isn't rebuilt in Rust yet. Your current app has it." } },
    }
}

#[component]
fn Explain() -> Element {
    let _ = VER();
    let hero = eng(|e| { let c = e.all_cards(); e.hero_model(&c) });
    rsx! {
        h2 { class: "sheet-t", "How this is worked out" }
        p { class: "lead", "{hero.explain}" }
        div { class: "rows plain",
            for (k, r) in hero.rows.iter().enumerate() {
                Row { key: "{k}", title: r.title.clone(), detail: r.detail.clone(), value: amt_s(r.amt, "plus"), tone: r.tone.clone(), total: r.total }
            }
        }
        if !hero.fixes.is_empty() {
            h3 { class: "sub-h", "Ways to close the gap" }
            div { class: "rows plain",
                for (k, r) in hero.fixes.iter().enumerate() {
                    Row { key: "f{k}", title: r.title.clone(), detail: r.detail.clone(), value: format!("{}{}", if r.up_to { "up to " } else { "" }, amt_s(r.amt, "in")), tone: "pos" }
                }
            }
            if hero.left_to_find >= 1.0 { Note { tone: "alert", {format!("Still {} to find.", amt(hero.left_to_find))} } }
        }
    }
}

#[component]
fn NetSheet() -> Element {
    let _ = VER();
    let n = eng(|e| { let c = e.all_cards(); e.net_model(&c) });
    let Some(n) = n else { return rsx! { h2 { class: "sheet-t", "Where you stand" } Note { "Set your bank balance first." } } };
    rsx! {
        h2 { class: "sheet-t", "Where you stand" }
        p { class: "lead", "Your bank balance less every card and what this month's salary still has to send." }
        div { class: "rows plain",
            Row { title: "In the bank", detail: "tracked from alerts", value: amt(n.b.bal) }
            if n.billed >= 0.5 { Row { title: "Card bills", detail: "billed, not paid yet", value: amt_s(n.billed, "out") } }
            if n.unbilled >= 0.5 { Row { title: "Spent on cards since the statement", detail: "on the next bills", value: amt_s(n.unbilled, "out") } }
            if n.back >= 0.5 { Row { title: "Back from others", detail: "spent for someone else", value: amt_s(n.back, "in"), tone: "pos" } }
            for r in n.owe.iter().chain(n.owe_next.iter()) { Row { key: "{r.name}", title: format!("Still to send: {}", r.name), value: amt_s(r.left, "out") } }
            Row { title: "Where you stand", value: amt(n.now), total: true, tone: if n.now < 0.0 { "alert".to_string() } else { String::new() } }
        }
        if let Some(x) = n.next.as_ref() {
            h3 { class: "sub-h", "After the next salary" }
            div { class: "rows plain",
                Row { title: format!("Salary {}", time::fmt(x.mp.cyc.p0)), detail: format!("{} · {}", x.status, x.basis), value: amt_s(x.mp.amt, "in"), tone: "pos" }
                Row { title: "Then", detail: "after its split, card bills already counted", value: amt(x.then), total: true }
            }
        }
    }
}

#[component]
fn History() -> Element {
    let _ = VER();
    let h = eng(|e| e.balance_history());
    let Some(h) = h else { return rsx! { h2 { class: "sheet-t", "Bank balance" } Note { "Set your bank balance first." } } };
    let n = h.pts.len();
    let pts = h.pts[n.saturating_sub(120)..].to_vec();
    let mut marks = h.marks.clone(); marks.sort_by(|a, b| b.d.cmp(&a.d)); marks.truncate(12);
    rsx! {
        h2 { class: "sheet-t", "Bank balance" }
        div { class: "fig big", {shown(&amt(h.now))} }
        BankChart { pts, ahead: vec![] }
        h3 { class: "sub-h", "Salaries, bills and the balances you set" }
        div { class: "rows plain",
            for (k, m) in marks.iter().enumerate() {
                Row { key: "{k}", title: m.title.clone(), detail: time::fmt_d(m.d), value: if m.kind == "set" { amt(m.amt) } else { amt_s(m.amt, "plus") }, tone: if m.kind == "salary" { "pos".to_string() } else { String::new() } }
            }
        }
    }
}
