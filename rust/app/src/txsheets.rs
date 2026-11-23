//! The sheets for one transaction: edit it (category, a payee rule, spent for someone else, paid back, a note), mark a
//! card payment reversed or refunded (and undo it), and add a payment the alerts missed (rn/src/sheets.js).

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::{not_spending, Edit, Engine, CATS, IN_PICK};
use money_core::time;

const NOT_SPEND_PICK: [&str; 4] = ["Cash & transfers", "Investments", "Money in", "Refunds"];
const IN_CATS: [&str; 7] = ["Salary", "Money in", "Refunds", "Cash & transfers", "Investments", "Other income", "Other"];
fn spend_cats() -> Vec<&'static str> { CATS.iter().copied().filter(|c| !not_spending(c)).collect() }
fn close() { *SHEET.write() = None; }
fn fail(msg: String) { toast(msg, "alert"); }

/// "Tue 2 Dec 2026 · 6:53 pm"
fn when_of(x: &money_core::engine::Row) -> String {
    let d = time::local(x.t.ym[0..4].parse().unwrap_or(1970), x.t.ym[5..7].parse::<i32>().unwrap_or(1) - 1, x.t.day);
    let c = Engine::clock_of(x.t.ts);
    format!("{} {}{}", time::fmt_d(d), &x.t.ym[0..4], if c.is_empty() { String::new() } else { format!(" · {}", c) })
}

#[component]
pub fn TxSheet(id: String) -> Element {
    let _ = VER();
    let x = eng(|e| e.all_tx().into_iter().find(|t| t.t.id == id));
    let Some(x) = x else { return rsx! { Note { "This transaction isn't here any more." } } };
    if x.reversed || x.t.refund_of.is_some() { return rsx! { RevSheet { id: id.clone() } }; }
    let (t, n, rule, notes_ok, data_in) = eng(|e| {
        let t = e.tx.iter().find(|y| y.id == id).cloned();
        let rule = t.as_ref().and_then(|t| e.rule_for(&t.desc));
        (t, e.note_of(&id).cloned().unwrap_or_default(), rule, e.notes_ok, e.data_in)
    });
    let is_pay = x.t.cat == "Card payment";
    let rule_on = rule.as_ref().map(|r| r.1 == x.t.cat).unwrap_or(false);
    let x0 = x.clone();
    let mut cat = use_signal(|| x0.t.cat.clone());
    let mut card = use_signal(|| x0.pay_card.clone().unwrap_or_default());
    let mut always = use_signal(|| rule_on);
    let mut other = use_signal(|| n.for_someone_else);
    let mut back = use_signal(|| x0.paid_back);
    let n0 = n.note.clone();
    let mut note = use_signal(|| n0.clone());
    let mut fold = use_signal(|| NOT_SPEND_PICK.contains(&x0.t.cat.as_str()));
    let inn = x.t.dir == "in";
    let rev = if !x.man && x.t.kind == "card" && !inn { eng(|e| e.rev_info(&id)) } else { None };
    let cats: Vec<&str> = if inn { IN_CATS.to_vec() } else { spend_cats().into_iter().filter(|c| !c.contains("unknown") || *c == x.t.cat).collect() };
    let (title, extra) = nice(&x.t.desc);
    let payee = if title.chars().count() > 30 { format!("{}…", money_core::fmt::take(&title, 28)) } else { title.clone() };
    let groups: Vec<Opt> = eng(|e| e.group_order.iter().filter(|k| e.is_open(k, Some(x.t.ts)) || Some((*k).clone()) == x.pay_card).map(|k| opt(k, &e.card_short(k))).collect());
    let has_t = t.is_some();
    let (sid, xs) = (id.clone(), x.clone());
    let save = move |_| {
        if is_pay {
            let c = card();
            if !c.is_empty() && Some(c.clone()) != xs.pay_card { act(|e| e.assign_payment(&sid, &c)); }
            close(); toast("Saved", ""); return;
        }
        let e = Edit { category: cat(), always: has_t && always(), rule_was: rule_on, for_other: other(), paid_back: back(), note: if notes_ok { note() } else { n0.clone() } };
        let msg = act(|en| en.save_edit(&sid, &e));
        if !msg.is_empty() { return fail(msg); }
        close(); toast("Saved", "");
    };
    let did = id.clone();
    rsx! {
        div { class: "tx-head",
            CatIc { cat: x.t.cat.clone(), big: true }
            div { class: "grow",
                div { class: if inn { "tx-amt t-pos" } else { "tx-amt" }, {shown(&exact_s(x.t.amt, if inn { "in" } else { "out" }))} }
                div { class: "tx-when", "{when_of(&x)} · {x.t.account}" }
            }
        }
        div { class: "tx-payee", "{title}" }
        if !extra.is_empty() { div { class: "tx-when", "{extra}" } }
        if is_pay {
            SubHead { text: "Which card did this pay?" }
            Chips { value: card(), onchange: move |v| card.set(v), options: groups.into_iter().chain(std::iter::once(opt("none", "Not a card payment"))).collect::<Vec<_>>() }
            if x.pay_confirmed { Note { "A confirmation email already says which card; pick only if it's wrong." } }
        } else {
            SubHead { text: "Category" }
            div { class: "chips",
                for c in cats.into_iter() {
                    Chip { key: "{c}", label: c, on: c == cat(), icon: cat_icon(c), hue: cat_hue(c), onclick: move |_| cat.set(c.to_string()) }
                }
                if !inn { Chip { label: "Not spending", dashed: true, icon: "down", onclick: move |_| fold.set(!fold()) } }
                if fold() && !inn {
                    for c in NOT_SPEND_PICK.into_iter() {
                        Chip { key: "n{c}", label: c, on: c == cat(), icon: cat_icon(c), hue: cat_hue(c), onclick: move |_| cat.set(c.to_string()) }
                    }
                }
            }
            if has_t {
                div { style: "margin-top:12px",
                    SwRow { title: format!("Always use this for {}", payee), detail: "saves a payee rule, for past and future payments", on: always(), onchange: move |v| always.set(v) }
                }
            }
        }
        if notes_ok && !inn && !is_pay { SwRow { title: "Spent for someone else", detail: "not your spending, and on a card bill it's left out of what you have to pay", on: other(), onchange: move |v| other.set(v) } }
        if has_t && inn && x.t.kind == "bank" { SwRow { title: "A friend paying me back", detail: "comes off your spending, like a refund", on: back(), onchange: move |v| back.set(v) } }
        if notes_ok { Field { label: "Note", value: note(), oninput: move |v| note.set(v), multiline: true, placeholder: "Anything to remember about it" } }
        if !notes_ok && data_in { Note { "Notes and \"spent for someone else\" need one database update first (see Settings)." } }
        if let Some(r) = rev { Reverse { id: id.clone(), account: x.t.account.clone(), amt: x.t.amt, on: r.on.clone(), billed: r.billed, matched: r.matched.as_ref().map(|m| (m.amt, m.ts)) } }
        div { class: "actions",
            if x.man { button { class: "btn b-ghost big danger", onclick: move |_| { act(|e| e.del_manual(&did)); close(); toast("Deleted", ""); }, "Delete" } }
            button { class: "btn b-solid big", onclick: save, "Save" }
        }
    }
}

/// A card payment that was reversed or refunded: mark it (or undo the mark). Before its bill closed it's dropped from
/// everything; after, the money comes back to the card today, off the next bill.
#[component]
fn Reverse(id: String, account: String, amt: f64, on: Option<String>, billed: bool, matched: Option<(f64, i64)>) -> Element {
    let (uid, mid, acc) = (id.clone(), id.clone(), account.clone());
    if let Some(on) = on {
        return rsx! {
            div { class: "rev-box",
                div { class: "rev-t", "Refunded · {time::parse_iso(&on).map(time::fmt).unwrap_or_default()}" }
                p { class: "rev-d", style: "color:var(--ink2);margin:2px 0 0", "It stays on the bill it was on, and {shown(&exact_s(amt, \"\"))} comes off your next {account} bill. It no longer counts as spending or earns points." }
                div { style: "margin-top:10px",
                    button { class: "btn b-ghost small", onclick: move |_| { act(|e| e.unreverse(&uid)); toast("Back as a normal payment", ""); }, "Undo: not refunded" }
                }
            }
        };
    }
    let mark = move |_| {
        let msg = act(|e| e.reverse(&mid));
        if !msg.is_empty() { return fail(msg); }
        close();
        toast_undo(if billed { format!("Marked as refunded: it comes off your next {} bill", acc) } else { "Marked as reversed: off the bill, your spending and points".to_string() }, "", Some(mid.clone()));
    };
    rsx! {
        div { style: "margin-top:16px",
            SubHead { text: "Reversed or refunded?" }
            if let Some((a, ts)) = matched { Note { {format!("A {} refund came back to this card on {}. If that was for this payment, it's already taken off and there's nothing to do.", shown(&exact_s(a, "")), time::fmt(ts))} } }
            button { class: "rev-mark", aria_label: "This payment was reversed or refunded", onclick: mark,
                div { class: "ic ic-alert", style: "width:34px;height:34px;border-radius:10px", Icon { name: "undo".to_string(), size: 18.0 } }
                div { class: "grow",
                    div { class: "rev-t t-alert", "This payment was reversed or refunded" }
                    div { class: "rev-d", if billed { "Its bill has closed, so the money comes off your next bill instead" } else { "Takes it off the card bill, your spending and points" } }
                }
            }
        }
    }
}

/// A reversed payment, or the refund you marked for one: what it means, and the way back.
#[component]
fn RevSheet(id: String) -> Element {
    let x = eng(|e| e.all_tx().into_iter().find(|t| t.t.id == id));
    let Some(x) = x else { return rsx! {} };
    let orig = x.t.refund_of.as_ref().and_then(|o| eng(|e| e.all_tx().into_iter().find(|t| &t.t.id == o)));
    let (title, _) = nice(&orig.as_ref().map(|o| o.t.desc.clone()).unwrap_or(x.t.desc.clone()));
    let inn = x.t.dir == "in";
    let back_id = x.t.refund_of.clone().unwrap_or(x.t.id.clone());
    let text = if x.reversed {
        "You marked this payment as reversed, so it's left out of the card bill, your spending, Safe to spend and points. It stays here so you can undo it.".to_string()
    } else {
        format!("The refund you marked for this payment{}. It comes off the {} bill after it, as a refund email would.", orig.as_ref().map(|o| format!(" ({})", time::fmt(o.t.ts))).unwrap_or_default(), x.t.account)
    };
    rsx! {
        div { class: "tx-head",
            div { class: if x.reversed { "ic big ic-alert" } else { "ic big ic-info" }, Icon { name: "undo".to_string(), size: 22.0 } }
            div { class: "grow",
                div { class: if x.reversed { "tx-amt r-val gone" } else if inn { "tx-amt t-pos" } else { "tx-amt" }, {shown(&exact_s(x.t.amt, if inn { "in" } else { "out" }))} }
                div { class: "tx-when", "{when_of(&x)} · {x.t.account}" }
            }
        }
        div { class: "tx-payee", "{title}" }
        div { class: "out-line", "{text}" }
        div { class: "actions",
            button { class: "btn b-ghost big", onclick: move |_| { act(|e| e.unreverse(&back_id)); close(); toast("Back as a normal payment", ""); },
                if x.reversed { "It wasn't reversed" } else { "It wasn't refunded" } }
        }
    }
}

/// Add money the alerts missed: out (a payment) or in (salary, from someone, paid back, a refund).
#[component]
pub fn AddSheet() -> Element {
    let (today, yest, banks, groups) = eng(|e| {
        let t = e.today();
        (time::iso(t), time::iso(time::add_days(t, -1)), e.banks.iter().map(|b| (b.key.clone(), b.name.clone(), b.full.clone())).collect::<Vec<_>>(),
         e.open_groups(None).into_iter().map(|k| (k.clone(), e.card_short(&k))).collect::<Vec<_>>())
    });
    let first_bank = banks.first().map(|b| b.0.clone()).unwrap_or("cash".into());
    let second = if banks.len() > 1 { banks[1].0.clone() } else { first_bank.clone() };
    let mut dir = use_signal(|| "out".to_string());
    let mut value = use_signal(String::new);
    let mut desc = use_signal(String::new);
    let mut cat = use_signal(|| "Food & dining".to_string());
    let fb = first_bank.clone();
    let mut acct = use_signal(move || fb.clone());
    let mut kind = use_signal(|| "Salary".to_string());
    let mut into = use_signal(move || second.clone());
    let mut when = use_signal(|| "today".to_string());
    let y0 = yest.clone();
    let mut date = use_signal(move || y0.clone());
    let mut err = use_signal(|| (String::new(), String::new()));
    let ph = |k: &str| match k { "Salary" => "Salary from work", "Money in" => "Who sent it", "Paid back" => "A friend, for dinner", "Refunds" => "A shop's refund", _ => "What it's for" };
    let accts: Vec<Opt> = banks.iter().map(|b| opt(&b.0, &format!("{} (UPI)", b.1))).chain(groups.iter().map(|g| opt(&g.0, &g.1))).chain(std::iter::once(opt("cash", "Cash"))).collect();
    let intos: Vec<Opt> = banks.iter().map(|b| opt(&b.0, &b.2)).chain(std::iter::once(opt("cash", "Cash"))).collect();
    let (td, yd) = (today.clone(), yest.clone());
    let save = move |_| {
        let v = money_core::engine::parse_float(&value());
        if !(v > 0.0) { err.set(("Enter the amount".into(), String::new())); return; }
        let inn = dir() == "in";
        let words = { let w = desc().trim().to_string(); if !w.is_empty() || !inn { w } else { IN_PICK.iter().find(|q| q.0 == kind()).map(|q| q.1).unwrap_or("Money in").to_string() } };
        if words.is_empty() { err.set((String::new(), "Say what it was for".into())); return; }
        let d = match when().as_str() { "today" => td.clone(), "yest" => yd.clone(), _ => date() };
        let msg = if inn { act(|e| e.add_manual(&words, &value(), &kind(), &d, &into(), "in")) } else { act(|e| e.add_manual(&words, &value(), &cat(), &d, &acct(), "")) };
        if !msg.is_empty() { return fail(msg); }
        close();
        toast(if inn { format!("Added {} in", rup(v)) } else { format!("Added {}", rup(v)) }, "");
    };
    let inn = dir() == "in";
    rsx! {
        h2 { class: "sheet-t", "Add a payment" }
        Seg { full: true, value: dir(), onchange: move |v| dir.set(v), options: vec![opt("out", "Money out"), opt("in", "Money in")] }
        Field { big: true, prefix: "₹", value: value(), numeric: true, placeholder: "0", label: "Amount (₹)", error: err().0, oninput: move |t| { value.set(t); err.set(Default::default()); } }
        Field { label: if inn { "From / what for" } else { "What for" }, value: desc(), placeholder: if inn { ph(&kind()) } else { "Auto to office" }, error: err().1,
            oninput: move |t| { desc.set(t); err.set(Default::default()); } }
        if !inn {
            SubHead { text: "Category" }
            Chips { value: cat(), onchange: move |v| cat.set(v), options: spend_cats().into_iter().filter(|c| !c.contains("unknown")).map(cat_opt).collect::<Vec<_>>() }
            SubHead { text: "Paid with" }
            Chips { value: acct(), onchange: move |v| acct.set(v), options: accts }
        } else {
            SubHead { text: "What is it" }
            Chips { value: kind(), onchange: move |v| kind.set(v), options: IN_PICK.iter().map(|(v, l)| Opt { v: v.to_string(), label: l.to_string(), icon: cat_icon(v), hue: cat_hue(v).into() }).collect::<Vec<_>>() }
            SubHead { text: "Received in" }
            Chips { value: into(), onchange: move |v| into.set(v), options: intos }
            Note { "A salary added here counts as that month's salary, and money into a bank goes into its balance." }
        }
        SubHead { text: "When" }
        Chips { value: when(), onchange: move |v| when.set(v), options: vec![opt("today", "Today"), opt("yest", "Yesterday"), opt("pick", "Pick a date")] }
        if when() == "pick" { Field { label: "Date", kind: "date", value: date(), max: today.clone(), oninput: move |v| date.set(v) } }
        div { class: "actions", button { class: "btn b-solid big", onclick: save, Icon { name: "plus".to_string(), size: 20.0 } span { style: "margin-left:6px", if inn { "Add money in" } else { "Add payment" } } } }
    }
}
