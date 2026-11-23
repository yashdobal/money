//! Trips (rn/src/screens/Trips.js): a trip paid for with card points. Where and how → the airline → the points it
//! takes → the best cards for that airline → the cards you can get; and the sheets for one card, the income used, the
//! monthly spending and where the numbers come from.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::engine::rulebook::rulebook;
use money_core::engine::{add_months, month_name, parse_float, TripModel, TripRow};
use money_core::fmt::{locale_in, money, round};
use money_core::time;
use serde_json::Value;

pub fn pts(n: f64) -> String { locale_in(round(n)) }
pub fn span(m: i32) -> String { if m < 12 { plural(m as i64, "month") } else if m % 12 != 0 { format!("{} yr {} mo", m / 12, m % 12) } else { plural((m / 12) as i64, "year") } }
pub fn lakh(n: f64) -> String { format!("₹{}L", locale_in(round(n / 10000.0) / 10.0)) }
fn people(n: i32) -> String { format!("{} {}", n, if n == 1 { "person" } else { "people" }) }
pub fn trip_where(m: &TripModel) -> String { let n = &m.need; format!("{} · {} · {} · {}", n.country.name, people(n.people), plural(n.nights as i64, "night"), if n.cabin == "j" { "Business" } else { "Economy" }) }
pub fn trip_ratio(r: f64) -> String { if r == 1.0 { "1 for 1".into() } else if r.fract() == 0.0 { format!("{} make 1", r) } else { format!("{} make 2", r * 2.0) } }
pub fn trip_rate(r: f64) -> String { format!("{}", round(r * 100.0) / 100.0) }
fn set_trip(k: &'static str, v: Value) { act(|e| e.set_trip(k, v)); }

/// A label with a line under it, and something on the right.
#[component]
pub fn Line(label: String, #[props(default)] sub: String, children: Element) -> Element {
    rsx! { div { class: "line", div { class: "grow", div { class: "ln-l", "{label}" } if !sub.is_empty() { div { class: "ln-s", "{sub}" } } } {children} } }
}
/// A rupee amount you can type over. Empty hands back None (use the app's own figure).
#[component]
pub fn Amount(value: Option<f64>, #[props(default)] placeholder: String, label: String, ondone: EventHandler<Option<f64>>, #[props(default)] plain: bool) -> Element {
    let mut text = use_signal(|| None::<String>);
    let shown_v = match text() { Some(t) => t, None => match value { None => String::new(), Some(v) => if HIDDEN() && !plain { "••••".into() } else { money(v) } } };
    let mut done = move || { let t = text().unwrap_or_default(); text.set(None); let v = parse_float(&t); if v.is_finite() { ondone.call(Some(round(v))); } else if t.is_empty() { ondone.call(None); } };
    let mut d2 = done.clone();
    rsx! {
        input { class: "amtf", inputmode: "numeric", aria_label: "{label}", placeholder: "{placeholder}", value: "{shown_v}",
            onfocus: move |_| text.set(Some(value.map(|v| format!("{}", round(v) as i64)).unwrap_or_default())),
            oninput: move |e| text.set(Some(e.value().chars().filter(|c| c.is_ascii_digit() || *c == '.').collect())),
            onblur: move |_| done(), onkeydown: move |e| { if e.key() == Key::Enter { d2() } } }
    }
}
#[component]
fn Q(text: String, #[props(default)] top: bool) -> Element { rsx! { div { class: if top { "q top" } else { "q" }, "{text}" } } }
#[component]
fn Stepper(k: &'static str, label: String, value: i32, max: i32) -> Element {
    rsx! {
        div { class: "stepper",
            span { class: "grow st-l", "{label}" }
            button { class: "st-b", disabled: value <= 1, aria_label: "Fewer {label.to_lowercase()}", onclick: move |_| set_trip(k, Value::from(value - 1)), "−" }
            span { class: "st-v", aria_label: "{label}: {value}", "{value}" }
            button { class: "st-b", disabled: value >= max, aria_label: "More {label.to_lowercase()}", onclick: move |_| set_trip(k, Value::from(value + 1)), "+" }
        }
    }
}
fn badge(text: &str, tone: &str) -> Element { rsx! { span { class: "badge2 b-{tone}", "{text}" } } }

#[component]
pub fn Trips() -> Element {
    let _ = VER();
    let m = eng(|e| e.trip_model());
    rsx! { div { class: "page", Trip { m: m.clone() } Airline { m: m.clone() } Points { m: m.clone() } Best { m: m.clone() } Get { m: m.clone() } Foot { m } } }
}

#[component]
fn Trip(m: TripModel) -> Element {
    let rb = rulebook();
    let (p, n) = (&m.plan, &m.need);
    let now = eng(|e| e.now());
    let months: Vec<(String, String)> = std::iter::once((String::new(), "No date yet".to_string()))
        .chain((0..48).map(|i| { let d = add_months(now, 1 + i); (time::ym_of(d), month_name(d)) })).collect();
    let touched = eng(|e| e.overrides.get("trip").and_then(|t| t.as_object()).map(|o| !o.is_empty()).unwrap_or(false));
    let when = p.when.clone();
    rsx! {
        Panel { title: "Your trip", kind: "w", i: 0, right: if touched { Some(rsx! { button { class: "btn b-link", onclick: move |_| act(|e| e.reset_trip()), "Start again" } }) } else { None },
            Q { text: "Where to", top: true }
            Chips { value: p.country.clone(), onchange: move |v: String| set_trip("country", Value::from(v)), options: rb.countries.iter().map(|c| opt(&c.id, &c.name)).collect::<Vec<_>>() }
            Q { text: "Hotel" }
            Line { label: "Pay for the hotel with points", sub: "off: you pay for the stay yourself",
                Switch { on: p.stay, label: "Pay for the hotel with points", onchange: move |v: bool| set_trip("stay", if v { Value::Null } else { Value::Bool(false) }) } }
            if p.stay {
                Line { label: "Budget",
                    Seg { value: p.hotel.to_string(), onchange: move |v: String| set_trip("hotel", Value::from(v.parse::<i64>().unwrap_or(1))),
                        options: rb.hotel_tier.iter().enumerate().map(|(i, t)| opt(&i.to_string(), &cap(t))).collect::<Vec<_>>() } }
                Line { label: "A room for a night", sub: if n.typed { format!("your price · usually {}", money(n.usual)) } else { format!("the usual {} price in {}", rb.hotel_tier[n.tier], n.country.name) },
                    Amount { plain: true, value: if n.typed { p.night } else { None }, placeholder: money(n.usual), label: "A room for a night in rupees",
                        ondone: move |v: Option<f64>| set_trip("night", v.map(Value::from).unwrap_or(Value::Null)) } }
            }
            Q { text: "Flight" }
            Line { label: "Class", Seg { value: p.cabin.clone(), onchange: move |v: String| set_trip("cabin", Value::from(v)), options: rb.cabins.iter().map(|(i, nm)| opt(i, nm)).collect::<Vec<_>>() } }
            Q { text: "Travel days" }
            div { class: "steps", Stepper { k: "nights", label: "Nights", value: p.nights, max: 30 } Stepper { k: "people", label: "Travellers", value: p.people, max: 6 } }
            label { class: "fwrap", span { class: "f-label", "When you want to fly (if you know)" }
                div { class: "fld", select { onchange: move |e| { let v = e.value(); set_trip("when", if v.is_empty() { Value::Null } else { Value::from(v) }); },
                    for (v, l) in months.into_iter() { option { key: "{v}", value: "{v}", selected: v == when, "{l}" } } } } }
        }
    }
}

#[component]
fn Airline(m: TripModel) -> Element {
    let rb = rulebook();
    let n = &m.need;
    let cab = if n.cabin == "j" { "business" } else { "economy" };
    rsx! {
        Panel { title: "Airline", i: 1,
            div { class: "rows",
                for a in n.airs.iter().cloned() {
                    {
                        let on = a.id == n.airline; let al = rb.airline(&a.id); let pref = a.id == n.preferred;
                        let id = a.id.clone();
                        rsx! {
                            button { key: "{a.id}", class: "row press", onclick: move |_| set_trip("air", if pref { Value::Null } else { Value::from(id.clone()) }),
                                div { class: if on { "ic ic-on fly" } else { "ic" }, Icon { name: "trips".to_string() } }
                                div { class: "r-main",
                                    div { class: "r-title", "{al.short}" if pref { "  " {badge("Preferred", "pos")} } }
                                    div { class: "r-detail", {format!("{} {} each way{}", pts(a.one_way), al.unit, al.via.as_ref().map(|v| format!(" · {}", v)).unwrap_or_default())} }
                                }
                                div { class: "r-right", div { class: "r-val", "{pts(a.total)}" } div { class: "r-sub", "for {people(n.people)}" } }
                            }
                        }
                    }
                }
            }
            Note { if n.airs.len() > 1 { {format!("{} is preferred because it asks for the fewest points. Tap the other to plan with it instead.", rb.airline(&n.preferred).short)} }
                else { {format!("Only {} has a confirmed {} price from Delhi to {}.", rb.airline(&n.airline).short, cab, n.country.city)} } }
            if n.no_business { div { class: "warnbox", "No confirmed business-class price to {n.country.name} on either airline, so the flights are counted in economy." } }
        }
    }
}

#[component]
fn Points(m: TripModel) -> Element {
    let rb = rulebook();
    let n = &m.need; let air = rb.airline(&n.airline);
    let mut notes = vec!["Taxes and airport fees on award tickets are paid in cash and aren't counted.".to_string()];
    if n.stay && n.country.rough && !n.typed { notes.push(format!("Room prices for {} are a rough guide. Type your own above if you know it.", n.country.name)); }
    rsx! {
        section { class: "panel k-d rise", style: "--i:2",
            div { class: "panel-head", h2 { "Points for this trip" } button { class: "ib on-dark", aria_label: "About Points for this trip", onclick: move |_| *SHEET.write() = Some("about-trips".into()), Icon { name: "info".to_string(), size: 18.0 } } }
            div { class: "d-l", "{trip_where(&m)}" }
            div { class: "d-fig2", "{pts(n.flight.total)}" }
            p { class: "d-p", b { "{air.name} {air.unit}" } " for the flights: {pts(n.flight.one_way)} each way × {people(n.people)}, Delhi to {n.country.city} and back." }
            if n.stay {
                div { class: "d-inset rows",
                    Row { icon: rsx! { Ic { name: "bed" } }, title: format!("Hotel, {}{}", rb.hotel_tier[n.tier], if n.typed { " (your price)" } else { "" }),
                        detail: format!("{} · {} at {} = {}", plural(n.nights as i64, "night"), plural(n.rooms as i64, "room"), money(n.nightly), money(n.hotel_cost)), value: pts(n.accor_pts), sub: "Accor points" }
                }
            } else { div { class: "d-soft", "The hotel isn't counted: you pay for the stay yourself." } }
            for (i, t) in notes.iter().enumerate() { p { key: "{i}", class: "note", "{t}" } }
        }
    }
}

fn named(x: &TripRow, invite: bool) -> Element {
    rsx! { "{x.card.name}" if x.owned { "  " {badge("Yours", "pos")} } else if invite && x.card.status != "open" { "  " {badge("Invite only", "")} } }
}
#[component]
fn Best(m: TripModel) -> Element {
    let rb = rulebook();
    let air = rb.airline(&m.need.airline);
    rsx! {
        Panel { title: "Best cards for {air.short}", i: 3,
            Note { "Best conversion first, whatever your income: the {air.short} {air.unit} that ₹100 of everyday spending turns into." }
            div { class: "rows",
                for x in m.best.iter().cloned() {
                    {
                        let done = x.run.as_ref().map(|r| r.months.is_some()).unwrap_or(false);
                        let id = x.card.id.clone();
                        let detail = format!("{}{}", trip_ratio(x.fl.as_ref().unwrap().ratio), if done { let s = x.run.as_ref().unwrap().spend; format!(" · {}", if s != 0.0 { format!("{} to spend", lakh(s)) } else { "you have the points".into() }) } else { String::new() });
                        rsx! {
                            button { key: "{x.card.id}", class: "row press", onclick: move |_| *SHEET.write() = Some(format!("tripcard:{}", id)),
                                div { class: "ic", Icon { name: "cards".to_string() } }
                                div { class: "r-main", div { class: "r-title", {named(&x, true)} } div { class: "r-detail", "{detail}" } }
                                div { class: "r-right", div { class: "r-val", "{trip_rate(x.rate)}" } div { class: "r-sub", "per ₹100" } }
                            }
                        }
                    }
                }
            }
            if !m.off.is_empty() { Note { {format!("Not listed because their points don't move to {}: {}.", air.short, m.off.iter().map(|x| x.card.name.clone()).collect::<Vec<_>>().join(", "))} } }
        }
    }
}
#[component]
fn Get(m: TripModel) -> Element {
    let rb = rulebook();
    let air = rb.airline(&m.need.airline); let inc = &m.income;
    let from = inc.from.clone().unwrap_or_default();
    rsx! {
        Panel { title: "Cards you can get", i: 4,
            if m.get.is_empty() { Note { "None of the cards that move to {air.short} is open to you on the income this goes by." } } else {
                div { class: "rows",
                    for x in m.get.iter().cloned() {
                        { let id = x.card.id.clone(); rsx! {
                            button { key: "{x.card.id}", class: "row press", onclick: move |_| *SHEET.write() = Some(format!("tripcard:{}", id)),
                                div { class: "ic", Icon { name: "cards".to_string() } }
                                div { class: "r-main", div { class: "r-title", {named(&x, false)} } }
                                span { class: "chev", Icon { name: "chev".to_string(), size: 18.0 } }
                            }
                        } }
                    }
                }
            }
            Note { {format!("{} The bank still decides each application.", match from.as_str() { "salary" => "Going by your salary, in the same order as above.", "you" => "Going by the income you set, in the same order as above.", _ => "Your income isn't set, so every card open to apply is listed." })} }
            button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some("trip-income".into()), if from.is_empty() { "Set your income" } else { "Change the income used" } }
        }
    }
}
#[component]
fn Foot(m: TripModel) -> Element {
    let rb = rulebook();
    let p = &m.plan;
    let basis = if p.spend.is_some() || p.travel.is_some() { "the figures you typed".to_string() } else if m.prof.basis == "months" { format!("your last {}", plural(m.prof.n as i64, "full month")) } else if m.prof.basis == "month" { "this month so far".into() } else { String::new() };
    let checked = time::parse_iso(&rb.trips_checked).map(time::fmt_y).unwrap_or_default();
    rsx! {
        Panel { kind: "w", i: 5,
            Note { if m.known { {format!("The spending and time shown for each card use {} a month of card spending ({}).", if HIDDEN() { "••••".into() } else { money(m.mix.earning) }, basis)} }
                else { {format!("The spending shown for each card uses {} a month until you add your own.", money(50000.0))} } }
            button { class: "btn b-link", style: "margin-bottom:12px", onclick: move |_| *SHEET.write() = Some("trip-spend".into()), "Change the monthly spending" }
            Note { "Card terms, transfer rates and award prices were checked on {checked}. They change often, award seats aren't always there, and the bank decides who gets a card. This is arithmetic to plan with, not financial advice." }
            div { style: "text-align:right", button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some("trip-sources".into()), "Where the numbers come from" } }
        }
    }
}

/* ---------------- the sheets ---------------- */
fn close() { *SHEET.write() = None; }
#[component]
pub fn KV(k: String, v: String, #[props(default)] d: String) -> Element {
    rsx! { div { class: "kv", div { class: "kv-r", span { class: "kv-k", "{k}" } span { class: "kv-v", "{v}" } } if !d.is_empty() { div { class: "kv-d", "{d}" } } } }
}
/// The pages a figure was read from, each with the day it was checked.
#[component]
pub fn Sources(keys: Vec<String>) -> Element {
    let rb = rulebook();
    let mut seen = std::collections::HashSet::new();
    let list: Vec<_> = keys.into_iter().filter(|k| seen.insert(k.clone())).filter_map(|k| rb.source(&k).map(|s| (k, s))).collect();
    rsx! {
        div { class: "srcs",
            for (k, s) in list.into_iter() {
                if s.url.is_empty() { div { key: "{k}", class: "src-i", div { class: "src-n", "{s.name}" } div { class: "src-a", "{s.at}" } } }
                else { a { key: "{k}", class: "src-i", href: "{s.url}", target: "_blank", rel: "noopener", div { class: "src-n link", "{s.name}" } div { class: "src-a", "{s.at}" } } }
            }
        }
    }
}
fn trip_kind_name(k: &str) -> &str { match k { "fuel" => "fuel", "utilities" => "bills", "rent" => "rent", "insurance" => "insurance", "education" => "school fees", "govt" => "taxes", "wallets" => "wallet loads", "jewellery" => "jewellery", k => k } }

#[component]
pub fn TripCardSheet(id: String) -> Element {
    let rb = rulebook();
    let m = eng(|e| e.trip_model());
    let x = m.all.iter().find(|r| r.card.id == id).cloned();
    let Some(x) = x else { return rsx! {} };
    let (o0, h0) = (x.owned, if x.have != 0.0 { format!("{}", x.have) } else { String::new() });
    let mut mine = use_signal(move || o0);
    let mut have = use_signal(move || h0.clone());
    let c = x.card.clone(); let n = &m.need; let air = rb.airline(&n.airline);
    let r2 = |v: f64| round(v * 100.0) / 100.0;
    let earn = if c.earn.air == c.earn.base && c.earn.ota == c.earn.base { format!("{} per ₹100 on everything that counts", r2(c.earn.base)) }
        else { format!("{} per ₹100, {} on flights booked with the airline{}", r2(c.earn.base), c.earn.air, if c.earn.ota == c.earn.air { " and on travel sites".to_string() } else { format!(", {} on travel sites", c.earn.ota) }) };
    let moves = [("ai", "Air India"), ("kf", "KrisFlyer"), ("accor", "Accor")].iter().filter_map(|(k, nm)| c.to_of(k).map(|r| format!("{} {}", nm, trip_ratio(r)))).collect::<Vec<_>>().join(" · ");
    let done = x.run.as_ref().map(|r| r.months.is_some()).unwrap_or(false);
    let head = if x.owned { "One of your cards.".to_string() } else if c.status != "open" { c.why.clone().unwrap_or_default() }
        else if !x.can_get { format!("Asks for an income of {} a year, more than the income this goes by.", money(c.income.unwrap_or(0.0))) }
        else { format!("{} The bank still decides each application.", match c.income { Some(i) if i != 0.0 => format!("Asks for an income of {} a year.", money(i)), _ => "The bank doesn't publish an income bar for this card.".into() }) };
    let auto = x.auto; let cid = id.clone();
    let ex = |v: f64| shown(&exact_s(v, ""));
    rsx! {
        h2 { class: "sheet-t", "{c.name}" }
        div { class: "out-line", "{head}" }
        SubHead { text: format!("For {}", trip_where(&m)) }
        div { class: "kvs",
            if let Some(fl) = &x.fl {
                KV { k: "Conversion", v: format!("{} {} {} per ₹100", trip_rate(x.rate), air.short, air.unit), d: format!("earns {} per ₹100, {}", r2(c.earn.base), trip_ratio(fl.ratio)) }
                KV { k: format!("Flights · {}", air.short), v: format!("{} {}", pts(fl.pts), c.pts), d: format!("{} {}, {}", pts(fl.miles), air.unit, trip_ratio(fl.ratio)) }
            }
            if let Some(ht) = &x.ht { KV { k: "Hotel · Accor", v: format!("{} {}", pts(ht.pts), c.pts), d: format!("{} Accor points, {}", pts(ht.points), trip_ratio(ht.ratio)) } }
            if x.fl.is_some() && x.ht.is_some() { KV { k: "Together", v: format!("{} {}", pts(x.total), c.pts) } }
            if x.owned && x.fl.is_some() { KV { k: "You have", v: format!("{} · {} to go", pts(x.have), pts(x.left)) } }
        }
        for (i, w) in x.warn.iter().enumerate() { div { key: "{i}", class: "warnbox", "{w}" } }
        if done {
            { let r = x.run.clone().unwrap(); rsx! {
                SubHead { text: if m.known { "At your spending".to_string() } else { format!("At {} a month", money(50000.0)) } }
                div { class: "kvs",
                    KV { k: "Points a month", v: pts(r.per_month) }
                    KV { k: "Spending it takes", v: ex(r.spend) }
                    KV { k: "Time", v: if r.months == Some(0) { "you have the points".to_string() } else if x.far { "more than 20 years".into() } else { format!("{}{}", span(r.months.unwrap()), x.ready.map(|d| format!(" · by {}", month_name(d))).unwrap_or_default()) } }
                    KV { k: "Fees on the way", v: ex(r.fees) }
                    if r.bonus != 0.0 { KV { k: "Bonus points counted", v: pts(r.bonus) } }
                    if let (Some(wd), Some(pace), Some(av)) = (m.when_date, x.pace, m.avail) { if av >= 1 && r.months != Some(0) { KV { k: format!("To fly in {}", month_name(wd)), v: format!("{} a month", ex(pace)) } } }
                }
            } }
        }
        SubHead { text: "The card" }
        div { class: "kvs",
            KV { k: "Yearly fee", v: format!("{} + GST", money(c.fee)), d: c.waive.filter(|w| *w != 0.0).map(|w| format!("waived at {} a year", lakh(w))).unwrap_or_default() }
            KV { k: "Earns", v: earn }
            KV { k: "Nothing on", v: c.no.iter().map(|k| trip_kind_name(k).to_string()).collect::<Vec<_>>().join(", ") }
            if let Some(w) = &c.welcome { KV { k: "Welcome", v: format!("{} {}", pts(w.pts), c.pts), d: if w.spend != 0.0 { format!("after {} in {} days", money(w.spend), w.days) } else { String::new() } } }
            else if let Some(wn) = &c.welcome_note { KV { k: "Welcome", v: wn.clone() } }
            for (i, ms) in c.milestones.iter().enumerate() { KV { key: "{i}", k: "Bonus", v: format!("{} at {}{}", pts(ms.pts), lakh(ms.at), if ms.per == "quarter" { " in a quarter" } else { " in a year" }) } }
            if let Some(r) = c.renewal.filter(|r| *r != 0.0) { KV { k: "Each renewal", v: format!("{} {}", pts(r), c.pts) } }
            KV { k: "Moves to", v: moves }
        }
        if let Some(nt) = &c.note { Note { "{nt}" } }
        SubHead { text: "Checked against" }
        Sources { keys: c.src.clone() }
        SubHead { text: if auto { "Your points" } else { "Got this card?" } }
        if !auto { SwRow { title: "I have this card", detail: "counts the points you already hold", on: mine(), onchange: move |v| mine.set(v) } }
        if mine() || auto { Field { label: "Points on it now", value: have(), numeric: true, placeholder: "0", oninput: move |v| have.set(v) } }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let on = if auto { false } else { mine() };
            let p = parse_float(&have()); let p = if p.is_finite() { round(p).max(0.0) } else { 0.0 };
            act(|e| e.set_trip_card(&cid, on, if on || auto { p } else { 0.0 }));
            close();
        }, "Save" } }
    }
}

/// The income the "cards you can get" list goes by.
#[component]
pub fn TripIncomeSheet() -> Element {
    let inc = eng(|e| e.trip_income(&e.trip_plan()));
    let mut v = use_signal(move || inc.amt.map(|a| format!("{}", a)).unwrap_or_default());
    let you = inc.from.as_deref() == Some("you");
    rsx! {
        h2 { class: "sheet-t", "Your income a year" }
        Note { "Only used to pick the cards you can apply for. It starts as your take-home pay × 12; banks usually look at pay before tax, so type that if you prefer." }
        Field { label: "Income a year (₹)", value: v(), numeric: true, oninput: move |t| v.set(t) }
        div { class: "actions",
            if you { button { class: "btn b-ghost big", onclick: move |_| { set_trip("income", Value::Null); close(); }, "Use my salary" } }
            button { class: "btn b-solid big", onclick: move |_| { let n = parse_float(&v()); set_trip("income", if n > 0.0 { Value::from(round(n) as i64) } else { Value::Null }); close(); }, "Save" }
        }
    }
}
/// The month of card spending the time and spending figures are worked out on.
#[component]
pub fn TripSpendSheet() -> Element {
    let m = eng(|e| e.trip_model());
    let typed = m.plan.spend.is_some() || m.plan.travel.is_some();
    let (e0, t0) = (m.mix.everyday, m.mix.travel);
    let mut a = use_signal(move || format!("{}", e0));
    let mut b = use_signal(move || format!("{}", t0));
    let lead = if typed { "With your own figures. ".to_string() } else if m.prof.basis == "months" { format!("The average of your last {}. ", plural(m.prof.n as i64, "full month")) }
        else if m.prof.basis == "month" { "This month so far, scaled to a full month. ".into() } else { "Nothing to go on yet: type what you spend. ".into() };
    let noearn = if m.mix.noearn >= 1.0 { format!(" {} a month on fuel, bills, rent, insurance, fees and taxes is left out: most cards pay no points on those.", shown(&exact_s(m.mix.noearn, ""))) } else { String::new() };
    rsx! {
        h2 { class: "sheet-t", "Your month on a card" }
        Note { "{lead}Money you send to people isn't counted, because a card can't pay it.{noearn}" }
        Field { label: "Everyday spending a month (₹)", value: a(), numeric: true, oninput: move |t| a.set(t) }
        Field { label: "Flights and hotels a month (₹)", value: b(), numeric: true, oninput: move |t| b.set(t) }
        div { class: "actions",
            if typed { button { class: "btn b-ghost big", onclick: move |_| { set_trip("spend", Value::Null); set_trip("travel", Value::Null); close(); }, "My real spending" } }
            button { class: "btn b-solid big", onclick: move |_| {
                let x = parse_float(&a()); let y = parse_float(&b());
                if a().trim().is_empty() { } else if x.is_finite() && round(x) != e0 { set_trip("spend", Value::from(round(x) as i64)); }
                if b().trim().is_empty() { } else if y.is_finite() && round(y) != t0 { set_trip("travel", Value::from(round(y) as i64)); }
                close();
            }, "Save" }
        }
    }
}
#[component]
pub fn TripSourcesSheet() -> Element {
    let rb = rulebook();
    let air_src: Vec<String> = rb.airline("ai").src.into_iter().chain(rb.airline("kf").src).collect();
    rsx! {
        h2 { class: "sheet-t", "Where the numbers come from" }
        Note { "Read from the pages below; each shows the day it was checked. Where two pages disagreed, the bank's or airline's own page was used." }
        SubHead { text: "Flight prices in points" } Sources { keys: air_src }
        SubHead { text: "Hotel points" } Sources { keys: rb.accor_src.clone() }
        SubHead { text: "Room prices" } Sources { keys: rb.countries.iter().map(|c| c.hsrc.clone()).collect::<Vec<_>>() }
        SubHead { text: "Cards" } Sources { keys: rb.trip_cards.iter().flat_map(|c| c.src.clone()).collect::<Vec<_>>() }
        SubHead { text: "Rupee rates" } Sources { keys: rb.fx_src.clone() }
        SubHead { text: "Not confirmed" }
        Note { "Business-class prices on Air India to Japan, South Korea, Thailand, Vietnam, Bali, the Maldives, Sri Lanka and France (KrisFlyer is used where it flies). Taxes and fees on award tickets. Room prices for Singapore, Bali, Sri Lanka and France come from travel guides rather than one booking average." }
        SubHead { text: "Left out" }
        Note { {rb.trip_out.iter().map(|o| format!("{}: {}", o.name, { let mut c = o.why.chars(); match c.next() { Some(f) => f.to_lowercase().collect::<String>() + c.as_str(), None => String::new() } })).collect::<Vec<_>>().join(" ")} }
    }
}
pub const ABOUT_TRIPS: &str = "Flights are the airline's own award price from Delhi, one way for one person, times two, times the travellers, in the class you picked. The hotel is priced through Accor (ibis, Novotel, Mercure, Pullman, Sofitel, Fairmont): 2,000 points take €40 off any stay, so the points follow the room price. One room for every two travellers. The usual valuations make Marriott and IHG cost more card points for the same room on every card here, so they are left out. Award seats are limited: having the points doesn't promise a seat on your dates, so aim to have them about two months early.";
