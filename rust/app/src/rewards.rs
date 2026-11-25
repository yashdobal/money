//! Rewards: which card to pay with. What each card earned this month (tap one for every
//! spend), the search ("Which card for…?") and its answer, what you left on the table, your next card, milestones and
//! fee waivers, and how it counts. Points are shown as points; ₹ only to compare cards (and for a cashback card).

use crate::kit::*;
use crate::state::*;
use crate::trips::{Amount, Line};
use dioxus::prelude::*;
use money_core::engine::rulebook::{rulebook, RewCard};
use money_core::engine::{rew_parse, rew_rate_text, MonthCard, RewardsModel, Search, SearchCard, Spend, Tip as TipM, Way, Worth};
use money_core::fmt::{locale_in, round};
use money_core::time;
use serde_json::Value;
use std::collections::HashMap;
use std::cell::RefCell;

/// A rupee value: one decimal under ₹10, whole rupees above.
pub fn rs(v: f64) -> String { if HIDDEN() { "₹ ••••".into() } else if v > 0.0 && v < 10.0 { format!("₹{}", locale_in(round(v * 10.0) / 10.0)) } else { format!("₹{}", locale_in(round(v))) } }
fn pct(v: f64, amt: f64) -> String { if amt > 0.0 { format!("{}%", locale_in(round(v / amt * 1000.0) / 10.0)) } else { String::new() } }
fn pts_of(n: f64) -> String { if HIDDEN() { "••••".into() } else { locale_in(round(n)) } }
/// What a card earned, in its own terms: "1,234 pts", "₹56", "120 NeuCoins".
pub fn earn_text(card: &RewCard, n: f64) -> String { match card.unit.as_str() { "points" => format!("{} pts", pts_of(n)), "cashback" => rs(n), u => format!("{} {}", pts_of(n), u) } }
fn partner_name(p: &str) -> &str { match p { "ai" => "Air India", "kf" => "KrisFlyer", "accor" => "Accor", p => p } }
fn worth_sub(card: &RewCard, w: &Worth) -> String {
    if card.unit == "cashback" { return String::new(); }
    format!("≈ {}{}", rs(w.best), match &w.partner { Some(p) if w.miles > w.cash => format!(" as {} points", partner_name(p)), _ => String::new() })
}
/// The booking portals that aren't shops (rewNot's REW_ROUTE_NAMES and smartbuy), by name.
const PORTALS: [(&str, &str); 4] = [("smartbuy", "HDFC SmartBuy"), ("traveledge", "Axis Travel EDGE"), ("hsbcapp", "HSBC Travel with Points"), ("amazonpay", "Amazon Pay")];
/// A shop's or portal's name from its id.
fn place_name(id: &str) -> String {
    PORTALS.iter().find(|p| p.0 == id).map(|p| p.1.to_string()).or_else(|| rulebook().shop(id).map(|s| s.name.clone())).unwrap_or_else(|| id.to_string())
}
/// "not on HDFC SmartBuy", or "booked direct" when every portal and travel site is ruled out.
fn not_text(not: &[String]) -> Option<String> {
    if not.is_empty() { return None; }
    let all = ["smartbuy", "traveledge", "hsbcapp", "makemytrip", "cleartrip", "goibibo"].iter().all(|id| not.iter().any(|x| x == id));
    if all { return Some("booked direct (no portal or travel site)".into()); }
    Some(format!("not on {}", not.iter().map(|x| place_name(x)).collect::<Vec<_>>().join(" or ")))
}
fn shop_name(id: &Option<String>) -> String { id.as_deref().and_then(|i| rulebook().shop(i)).map(|s| s.name.clone()).unwrap_or_default() }
fn unit_of(card: &RewCard) -> String { if card.unit == "points" { "points".into() } else { card.unit.clone() } }
/// How to pay, in words.
pub fn way_text(w: Option<&Way>) -> String {
    let Some(w) = w else { return String::new() };
    if w.route == "card" {
        let wh = if w.at.is_some() { format!("Pay at {} with this card", shop_name(&w.at)) } else { "Pay with this card".into() };
        return if !w.label.is_empty() && w.label != "On the card" { format!("{} · {}", wh, w.label) } else { wh };
    }
    format!("{}{}", w.how, if w.at.is_some() && !w.route.contains("voucher") && w.route != "amazonpay" { format!(" ({})", shop_name(&w.at)) } else { String::new() })
}

#[component]
pub fn Rewards() -> Element {
    let _ = VER();
    let m = memo("rewards_model", |e| e.rewards_model());
    rsx! { div { class: "page", ThisMonth { m: m.clone() } SearchBox {} Missed { m: m.clone() } NextCard { m: m.clone() } Goals { m: m.clone() } Prefs { m } } }
}

/* ---------------- the search ---------------- */
const EXAMPLES: [&str; 6] = ["Flight to Tokyo 40k", "Swiggy order 600", "New iPhone 80,000", "Myntra 4,000", "Electricity bill 2,500", "Dinner in Dubai 5,000"];
/// What you searched for (kept while the app is open).
pub static QUERY: GlobalSignal<String> = Signal::global(String::new);
thread_local! { static AI: RefCell<HashMap<String, Option<serde_json::Map<String, Value>>>> = RefCell::new(HashMap::new()); }

/// The app function's AI reading of your words ("rew-parse"): only a known kind and shop, a positive amount, true/false.
async fn ask_ai(q: &str) -> Option<serde_json::Map<String, Value>> {
    if *DEMO.read() { return None; }
    let key = q.trim().to_lowercase();
    if key.is_empty() { return None; }
    if let Some(v) = AI.with(|a| a.borrow().get(&key).cloned()) { return v; }
    let rb = rulebook();
    let s = fresh().await?;
    let body = serde_json::json!({ "action": "rew-parse", "text": q.chars().take(300).collect::<String>(),
        "kinds": rb.kinds.iter().map(|k| vec![k.id.clone(), k.name.clone()]).collect::<Vec<_>>(),
        "shops": rb.shops.iter().filter(|s| s.id != "smartbuy").map(|s| vec![s.id.clone(), s.name.clone()]).collect::<Vec<_>>(),
        "portals": PORTALS.iter().map(|p| vec![p.0, p.1]).collect::<Vec<_>>() });
    let out = match crate::api::call_app(&s, body).await { Ok((200, o)) if o.get("ok") == Some(&Value::Bool(true)) => o.get("spend").cloned(), _ => None };
    let clean = out.and_then(|sp| {
        let mut o = serde_json::Map::new();
        if let Some(k) = sp.get("kind").and_then(|k| k.as_str()).filter(|k| rb.kinds.iter().any(|x| x.id == *k)) { o.insert("kind".into(), Value::from(k)); }
        match sp.get("shop") { Some(Value::Null) => { o.insert("shop".into(), Value::Null); } Some(Value::String(x)) if rb.shop(x).is_some() => { o.insert("shop".into(), Value::from(x.clone())); } _ => {} }
        if let Some(a) = sp.get("amt").and_then(|a| a.as_f64()).filter(|a| a.is_finite() && *a > 0.0 && *a < 1e9) { o.insert("amt".into(), Value::from(round(a) as i64)); }
        if let Some(b) = sp.get("online").and_then(|b| b.as_bool()) { o.insert("online".into(), Value::Bool(b)); }
        if let Some(b) = sp.get("intl").and_then(|b| b.as_bool()) { o.insert("intl".into(), Value::Bool(b)); }
        if let Some(n) = sp.get("not").and_then(|n| n.as_array()) {
            let known: Vec<Value> = n.iter().filter_map(|x| x.as_str()).filter(|x| rb.shop(x).is_some() || PORTALS.iter().any(|p| p.0 == *x)).map(Value::from).collect();
            o.insert("not".into(), Value::Array(known));
        }
        if o.is_empty() { None } else { Some(o) }
    });
    AI.with(|a| a.borrow_mut().insert(key, clean.clone()));
    clean
}
fn apply(sp: &mut Spend, o: &serde_json::Map<String, Value>) {
    if let Some(k) = o.get("kind").and_then(|v| v.as_str()) { sp.kind = k.into(); }
    if let Some(v) = o.get("shop") { sp.shop = v.as_str().map(String::from); }
    if let Some(a) = o.get("amt") { sp.amt = a.as_f64(); }
    if let Some(b) = o.get("online").and_then(|v| v.as_bool()) { sp.online = b; }
    if let Some(b) = o.get("intl").and_then(|v| v.as_bool()) { sp.intl = b; }
    // the AI's "not" adds to the app's own (it reads "non SmartBuy" as well, but may also catch what the rules miss)
    if let Some(n) = o.get("not").and_then(|v| v.as_array()) { for x in n.iter().filter_map(|x| x.as_str()) { if !sp.not.iter().any(|y| y == x) { sp.not.push(x.to_string()); } } }
    if sp.shop.as_ref().map(|s| sp.not.contains(s)).unwrap_or(false) { sp.shop = None; }
}

#[component]
fn SearchBox() -> Element {
    let _ = VER();
    let q = QUERY();
    let q0 = q.clone();
    let mut text = use_signal(move || q0.clone());
    let mut edit = use_signal(serde_json::Map::<String, Value>::new);
    let mut ai = use_signal(|| None::<(String, serde_json::Map<String, Value>)>);
    let mut asking = use_signal(|| false);
    let mut last = use_signal(String::new);
    if q != last() {
        last.set(q.clone()); text.set(q.clone()); edit.set(Default::default());
        if q.is_empty() { ai.set(None); } else {
            asking.set(true);
            let qq = q.clone();
            spawn(async move { let r = ask_ai(&qq).await; if QUERY() == qq { ai.set(r.map(|r| (qq.clone(), r))); asking.set(false); } });
        }
    }
    let go = move |t: String| { *QUERY.write() = t.trim().to_string(); };
    let (sp, typed) = if q.is_empty() { (None, None) } else {
        let parsed = rew_parse(&q);
        let mut sp = parsed.clone();
        if let Some((aq, o)) = ai() { if aq == q { apply(&mut sp, &o); } }
        apply(&mut sp, &edit());
        (Some(sp), Some(parsed))
    };
    let res = sp.as_ref().map(|s| eng(|e| e.rew_search(s)));
    let from_ai = ai().map(|a| a.0 == q).unwrap_or(false);
    rsx! {
        Panel { title: "Which card for…?", kind: "w", i: 1,
            div { class: "rsearch",
                Icon { name: "search".to_string(), size: 19.0 }
                input { r#type: "text", enterkeyhint: "search", placeholder: "A flight, a phone, a Swiggy order…", aria_label: "What are you buying?", value: "{text}", autocomplete: "off",
                    oninput: move |e| text.set(e.value()), onkeydown: move |e| { if e.key() == Key::Enter { go(text()); } } }
                if !text().is_empty() { button { class: "ib", aria_label: "Clear", onclick: move |_| { text.set(String::new()); go(String::new()); }, Icon { name: "close".to_string(), size: 17.0 } } }
            }
            div { style: "display:flex;justify-content:flex-end;margin-top:10px",
                button { class: "btn small b-solid", disabled: text().trim().is_empty(), onclick: move |_| go(text()), "Find the best card" } }
            if q.is_empty() {
                Note { "Say what it is, and the amount if you know it. Try:" }
                div { class: "chips", for x in EXAMPLES { Chip { key: "{x}", small: true, label: x, onclick: move |_| { text.set(x.into()); go(x.into()); } } } }
            }
            if let (Some(sp), Some(_t)) = (sp.clone(), typed) { Understood { sp, asking: asking(), ai: from_ai, onedit: move |(k, v): (String, Value)| { edit.write().insert(k, v); } } }
        }
        if let Some(r) = res {
            Answer { res: r.clone() }
            WebCheck { key: "{web_key(&q, &r.sp)}", q: q.clone(), res: r.clone() }
            Yours { res: r.clone() } Could { res: r }
        }
    }
}

/// "Understood as": what the search took your words to mean, each part changeable.
#[component]
fn Understood(sp: Spend, asking: bool, ai: bool, onedit: EventHandler<(String, Value)>) -> Element {
    let rb = rulebook();
    let mut open = use_signal(|| false);
    let parts: Vec<String> = [Some(rb.kind(&sp.kind).name.clone()), sp.shop.as_ref().map(|_| format!("at {}", shop_name(&sp.shop))),
        Some(match sp.amt { Some(a) if a > 0.0 => rs(a), _ => format!("{} (no amount given)", rs(1000.0)) }),
        Some(if sp.intl { "in a foreign currency".into() } else if sp.online { "online".into() } else { "in a shop".into() }), not_text(&sp.not)].into_iter().flatten().collect();
    let shop = sp.shop.clone().unwrap_or_default();
    rsx! {
        div { class: "understood",
            div { class: "u-l", if ai { "Understood as:" } else if asking { "Understood as (checking…):" } else { "Understood as:" } }
            div { class: "u-t", "{parts.join(\" · \")}" }
            button { class: "more", onclick: move |_| open.set(!open()), span { if open() { "Show less" } else { "Not what you meant?" } } Icon { name: "down".to_string(), size: 14.0, sw: 2.4 } }
            if open() {
                div { class: "more-in",
                    label { class: "fwrap", span { class: "f-label", "Kind of spending" } div { class: "fld", select { onchange: move |e| onedit.call(("kind".into(), Value::from(e.value()))),
                        for k in rb.kinds.iter() { option { key: "{k.id}", value: "{k.id}", selected: k.id == sp.kind, "{k.name}" } } } } }
                    label { class: "fwrap", span { class: "f-label", "Shop" } div { class: "fld", select { onchange: move |e| { let v = e.value(); onedit.call(("shop".into(), if v.is_empty() { Value::Null } else { Value::from(v) })) },
                        option { value: "", selected: shop.is_empty(), "No particular shop" }
                        for s in rb.shops.iter().filter(|s| s.id != "smartbuy") { option { key: "{s.id}", value: "{s.id}", selected: s.id == shop, "{s.name}" } } } } }
                    Line { label: "Amount", Amount { plain: true, value: sp.amt, placeholder: "₹1,000", label: "Amount in rupees", ondone: move |v: Option<f64>| onedit.call(("amt".into(), v.map(Value::from).unwrap_or(Value::Null))) } }
                    Line { label: "Where you pay", Seg { value: if sp.online { "on".to_string() } else { "off".to_string() }, onchange: move |v: String| onedit.call(("online".into(), Value::Bool(v == "on"))), options: vec![opt("on", "Online"), opt("off", "In a shop")] } }
                    Line { label: "In a foreign currency", Switch { on: sp.intl, label: "In a foreign currency", onchange: move |v: bool| onedit.call(("intl".into(), Value::Bool(v))) } }
                }
            }
        }
    }
}

#[component]
fn Answer(res: Search) -> Element {
    let rb = rulebook();
    let sp = &res.sp; let kind = rb.kind(&sp.kind).name.clone();
    let amt = sp.amt.unwrap_or(1000.0);
    let top = res.top.clone();
    if let Some(t) = &top { if let Some(b) = &t.best { if !(b.net > 0.004) && b.fee.is_some() && b.worth.best > 0.0 {
        return rsx! {
            section { class: "panel k-d rise", style: "--i:2",
                div { class: "panel-head", h2 { "Best card" } }
                div { class: "d-h", "Every card of yours costs more than it earns here" }
                p { class: "d-p", "{t.short} earns {rs(b.worth.best)} but its {t.card.fx.unwrap_or(0.0)}% foreign-currency markup is {rs(b.fee.unwrap_or(0.0))}." }
                if let Some(bt) = &res.better { p { class: "d-p", "{bt.card.name()} would come out {rs(bt.best.as_ref().unwrap().net)} ahead." } }
            }
        };
    } } }
    if top.as_ref().map(|t| !(t.best.as_ref().unwrap().net > 0.004)).unwrap_or(true) {
        let why = top.as_ref().and_then(|t| t.best.as_ref()).and_then(|b| b.notes.first().cloned()).unwrap_or_else(|| format!("{} earns nothing on the cards you hold.", kind));
        return rsx! {
            section { class: "panel k-d rise", style: "--i:2",
                div { class: "panel-head", h2 { "Best card" } }
                div { class: "d-h", "None of your cards earns on this" }
                p { class: "d-p", "{why}" }
                if let Some(bt) = &res.better { p { class: "d-p", "{bt.card.name()} would earn {rs(bt.best.as_ref().unwrap().worth.best)} on it." } }
            }
        };
    }
    let t = top.unwrap(); let w = t.best.clone().unwrap(); let card = t.card; let both = card.unit == "points";
    let mut notes = vec![];
    if w.capped { notes.push("Part of this is over a monthly cap, so it earns less than the full rate (what you've already used this month is counted).".to_string()); }
    notes.extend(w.notes.iter().cloned());
    if let Some(f) = w.fee { notes.push(format!("The bank's {}% foreign-currency markup ({}) is taken off.", card.fx.unwrap_or(0.0), rs(f))); }
    if t.add_on { notes.push("Yours is an add-on card: the points land with the main cardholder.".into()); }
    if let Some(n) = &card.note { notes.push(n.clone()); }
    if !res.typed_amt { notes.push("No amount given, so this is for ₹1,000.".into()); }
    let runner = res.runner.as_ref().map(|r| { let b = r.best.as_ref().unwrap(); let wt = way_text(Some(b));
        format!("Next best: {}, {}{}{}", r.short, earn_text(r.card, b.pts), if r.card.unit == "cashback" { String::new() } else { format!(" (≈ {})", rs(b.net)) },
            if wt == "Pay with this card" { String::new() } else { format!(" · {}", wt.trim_start_matches("Pay with this card · ")) }) });
    rsx! {
        section { class: "panel k-d rise", style: "--i:2",
            div { class: "panel-head", h2 { "Best card · {kind.to_lowercase()}" } }
            div { class: "d-h big", "{t.short}" }
            p { class: "d-p", style: "margin-top:2px", "{way_text(Some(&w))}" }
            div { class: "best-fig",
                span { class: "bf-n", if both { "{pts_of(w.pts)}" } else { "{rs(w.net)}" } }
                span { class: "bf-s", if both { "points · ≈ {rs(w.net)} ({pct(w.net, amt)}) on {rs(amt)}" } else { "{pct(w.net, amt)} back on {rs(amt)}" } }
            }
            div { class: "d-tiles",
                if both {
                    Tile { label: "As cash", value: rs(w.worth.cash), sub: card.cash.as_ref().map(|c| c.how.clone()).unwrap_or_default() }
                    Tile { label: "As miles", value: if w.worth.partner.is_some() { rs(w.worth.miles) } else { "—".to_string() },
                        sub: match &w.worth.partner { Some(p) => format!("{} pts → {}", pts_of(w.pts), partner_name(p)), None => "no airline partner".into() } }
                } else { Tile { label: cap(&unit_of(card)), value: rs(w.worth.cash), sub: card.cash.as_ref().map(|c| c.how.clone()).unwrap_or_default() } }
            }
            if both { p { class: "d-small", "At {round(w.rate * 100.0) / 100.0} points per ₹100" } }
            if let Some(r) = runner { p { class: "d-p", "{r}" } }
            for (i, n) in notes.iter().enumerate() { p { key: "{i}", class: "note", "{n}" } }
        }
    }
}
#[component]
fn Yours(res: Search) -> Element {
    if res.yours.len() < 2 && res.unknown.is_empty() { return rsx! {} }
    let amt = res.sp.amt.unwrap_or(1000.0);
    rsx! {
        Panel { title: "Your cards for this", i: 3,
            div { class: "rows",
                for y in res.yours.iter() {
                    { let b = y.best.as_ref(); let ok = b.map(|b| b.net > 0.0).unwrap_or(false); rsx! {
                        Row { key: "{y.g.clone().unwrap_or_default()}", icon: rsx! { Ic { name: "cards" } }, title: y.short.clone(), detail: way_text(b),
                            value: if ok { earn_text(y.card, b.unwrap().pts) } else { "—".to_string() },
                            sub: if ok { if y.card.unit == "cashback" { pct(b.unwrap().net, amt) } else { format!("≈ {}", rs(b.unwrap().net)) } } else { "earns nothing".to_string() }, soft: !ok }
                    } }
                }
            }
            if !res.unknown.is_empty() { Note { {format!("Not counted (their rules aren't in the app yet): {}.", res.unknown.iter().map(|h| h.short.clone()).collect::<Vec<_>>().join(", "))} } }
        }
    }
}
#[component]
fn Could(res: Search) -> Element {
    let mine = res.top.as_ref().and_then(|t| t.best.as_ref()).map(|b| b.net).unwrap_or(0.0);
    let rows: Vec<SearchCard> = res.could.iter().filter(|x| x.best.as_ref().map(|b| b.net > mine + 0.5).unwrap_or(false)).take(3).cloned().collect();
    let inc = &res.income; let amt = res.sp.amt.unwrap_or(1000.0);
    let from = inc.from.clone().unwrap_or_default();
    rsx! {
        Panel { title: "If you had…", i: 4,
            if rows.is_empty() { Note { "None of the cards open to you would do better than yours on this." } } else {
                div { class: "rows",
                    for x in rows.iter() {
                        { let b = x.best.as_ref().unwrap(); rsx! {
                            div { key: "{x.card.id}", class: "row",
                                div { class: "ic", Icon { name: "cards".to_string() } }
                                div { class: "r-main", div { class: "r-title", "{x.card.name()}  " span { class: "badge2 b-pos", "+{rs(b.net - mine)}" } } div { class: "r-detail", "{way_text(Some(b))}" } }
                                div { class: "r-right", div { class: "r-val", "{earn_text(x.card, b.pts)}" } div { class: "r-sub", if x.card.unit == "cashback" { "{pct(b.net, amt)}" } else { "≈ {rs(b.net)}" } } }
                            }
                        } }
                    }
                }
            }
            Note { {format!("{}. Cards that don't publish one are counted too. The bank still decides each application.", if inc.amt.is_some() { format!("Cards whose published income bar is within {}", if from == "you" { "the income you set" } else { "your salary (gross, for a year)" }) } else { "Your income isn't set, so every open card is counted".into() })} }
            button { class: "btn b-link", onclick: move |_| *SHEET.write() = Some("trip-income".into()), if from.is_empty() { "Set your income" } else { "Change the income used" } }
        }
    }
}

/* ---------------- this month ---------------- */
fn cap_short(n: &str) -> String { if n.chars().count() > 26 { format!("{}…", money_core::fmt::take(n, 24).trim()) } else { n.to_string() } }
#[component]
fn ThisMonth(m: RewardsModel) -> Element {
    let rows: Vec<MonthCard> = m.month.iter().filter(|h| h.card.is_some()).cloned().collect();
    let unknown: Vec<&MonthCard> = m.month.iter().filter(|h| h.card.is_none()).collect();
    if rows.is_empty() { return rsx! {} }
    let total: f64 = rows.iter().map(|h| h.worth.as_ref().map(|w| w.best).unwrap_or(0.0)).sum();
    let spends: usize = rows.iter().map(|h| h.n).sum();
    let month = eng(|e| time::MONFULL[time::month(e.now()) as usize]);
    rsx! {
        Panel { title: "Earned this month · {month}", i: 0,
            Note { if spends > 0 { {format!("From {} the app has seen, worth about {} in all. Tap a card to see every spend and how it earned.", plural(spends as i64, "card spend"), rs(total))} } else { "No card spending yet this month." } }
            div { class: "rows",
                for h in rows.into_iter() {
                    { let card = h.card.unwrap(); let g = h.g.clone();
                      let cap_line = h.full.as_ref().map(|f| format!(" · {} cap {}% used", cap_short(&f.name), round(f.used / f.max * 100.0) as i64)).unwrap_or_default();
                      rsx! {
                        Row { key: "{h.g}", icon: rsx! { Ic { name: "cards" } }, title: h.short.clone(), chevron: true, onclick: move |_| *SHEET.write() = Some(format!("rewcard:{}", g)),
                            detail: format!("{}{}", if h.n > 0 { format!("{} · {}", plural(h.n as i64, "spend"), rs(h.spent)) } else { "nothing yet".into() }, cap_line),
                            value: earn_text(card, h.pts), sub: if card.unit == "cashback" { "cashback".to_string() } else { worth_sub(card, h.worth.as_ref().unwrap()) }, soft: h.n == 0 }
                    } }
                }
            }
            if !unknown.is_empty() { Note { {format!("Not worked out (their rules aren't in the app yet): {}.", unknown.iter().map(|h| h.short.clone()).collect::<Vec<_>>().join(", "))} } }
        }
    }
}

/// One card this month: every spend, how it earned and its caps.
#[component]
pub fn RewCardSheet(g: String) -> Element {
    let _ = VER();
    let h = eng(|e| e.rew_month().into_iter().find(|x| x.g == g));
    let Some(h) = h.filter(|h| h.card.is_some()) else { return rsx! { Note { "The app doesn't have this card's rules yet." } } };
    let card = h.card.unwrap();
    let eff = if h.spent > 0.0 { h.pts / h.spent * 100.0 } else { 0.0 };
    let caps: Vec<_> = h.caps.iter().filter(|c| c.per != "quarter" && (c.used > 0.0 || c.name.contains("bonus"))).cloned().collect();
    let mut notes = vec![];
    if h.add_on { notes.push("Yours is an add-on card: the points land with the main cardholder.".to_string()); }
    if let Some(n) = &card.note { notes.push(n.clone()); }
    notes.push("Worked out from the card's published rules and the spends the app has seen. Your statement has the final number.".into());
    let month = eng(|e| time::MONFULL[time::month(e.now()) as usize]);
    let worth = h.worth.clone().unwrap_or_default();
    rsx! {
        h2 { class: "sheet-t", "{h.short} this month" }
        div { class: "small2", "{month} so far" }
        div { class: "fig big", "{earn_text(card, h.pts)}" }
        p { class: "line2", if card.unit == "cashback" { {card.cash.as_ref().map(|c| cap(&c.how)).unwrap_or_default()} } else { {format!("{}{}", worth_sub(card, &worth), card.cash.as_ref().map(|c| format!(" · cash value {} {}", rs(worth.cash), c.how)).unwrap_or_default())} } }
        div { class: "minis",
            div { class: "mini", div { class: "m-l", "Spent on it" } div { class: "m-v", "{rs(h.spent)}" } div { class: "m-s", "{plural(h.n as i64, \"spend\")}" } }
            div { class: "mini", div { class: "m-l", "Earned on average" } div { class: "m-v", if h.n > 0 { "{rew_rate_text(card, eff)}" } else { "—" } } div { class: "m-s", "across every spend" } }
        }
        if !h.ways.is_empty() {
            SubHead { text: "How you earned them" }
            div { class: "rows plain",
                for w in h.ways.iter() {
                    Row { key: "{w.key}", icon: rsx! { Ic { name: if w.none { "close".to_string() } else { "spark".to_string() }, tone: if w.none { String::new() } else { "info".to_string() } } },
                        title: if w.none { if w.why.is_empty() { "Earns nothing".to_string() } else { w.why.clone() } } else { w.text.clone() },
                        detail: format!("{} · {}", plural(w.n as i64, "spend"), rs(w.amt)), value: if w.none { "0".to_string() } else { earn_text(card, w.pts) }, soft: w.none }
                }
            }
        }
        if !caps.is_empty() {
            SubHead { text: "Caps this month" }
            for (i, c) in caps.iter().enumerate() {
                { let p = (c.used / c.max * 100.0).min(100.0); rsx! {
                    div { key: "{c.id}", class: "capbar", style: if i > 0 { "margin-top:14px" } else { "margin-top:2px" },
                        div { class: "cb-h", span { class: "grow", "{c.name}" } span { class: if p >= 90.0 { "t-alert" } else { "t-soft2" }, "{pts_of(c.used)} of {pts_of(c.max)}" } }
                        div { class: "cb-s", {format!("{} a {}{}", if c.on == "extra" { "bonus points" } else { "points" }, if c.per == "cycle" { "statement" } else { "month" }, if p >= 100.0 { " · full: more spending here earns less" } else { "" })} }
                        div { class: "bar", i { style: format!("width:{}%;background:{}", p, if p >= 90.0 { "var(--alert)" } else { "var(--accent)" }) } }
                    }
                } }
            }
        }
        if !h.items.is_empty() {
            SubHead { text: "Every spend" }
            div { class: "rows plain",
                for x in h.items.iter() {
                    { let id = x.id.clone(); let ok = x.pts > 0.0; rsx! {
                        Row { key: "{x.id}", icon: rsx! { Ic { name: if ok { "spark".to_string() } else { "close".to_string() }, tone: if ok { "info".to_string() } else { String::new() } } }, title: nice(&x.desc).0,
                            detail: format!("{} · {}{}{}", time::fmt(x.ts), if ok { x.how.clone() } else if x.why.is_empty() { "earns nothing".into() } else { x.why.clone() }, if x.capped { " · over a cap" } else { "" }, if x.for_other { " · for someone else" } else { "" }),
                            value: if ok { format!("+{}", earn_text(card, x.pts)) } else { "0".to_string() }, sub: rs(x.amt), soft: !ok, onclick: move |_| *SHEET.write() = Some(format!("tx:{}", id)) }
                    } }
                }
            }
        } else { Note { "No spending on this card yet this month." } }
        for (i, t) in notes.iter().enumerate() { Note { key: "{i}", "{t}" } }
    }
}

/* ---------------- left on the table ---------------- */
#[component]
fn Missed(m: RewardsModel) -> Element {
    let x = &m.missed;
    if x.n == 0 || x.cards == 0 { return rsx! {} }
    let share = if x.could > 0.0 { (x.got / x.could * 100.0).min(100.0) } else { 100.0 };
    rsx! {
        Panel { title: "Left on the table this month", i: 5,
            div { class: "mi-h", if x.gap >= 1.0 { "{rs(x.gap)} more was possible" } else { "You used your best card every time" } }
            p { class: "line2", if x.gap >= 1.0 { "with the cards you already have, paying the way shown below." } else { {format!("on all {} this month.", plural(x.n as i64, "spend"))} } }
            div { style: "margin-top:12px",
                div { class: "bar", style: "height:8px", i { style: format!("height:8px;width:{}%;background:{}", share, if x.gap >= 1.0 { "var(--warn)" } else { "var(--pos)" }) } }
                div { class: "mi-ends", span { "You earned {rs(x.got)}" } span { "Best possible {rs(x.could)}" } }
            }
            if !x.tips.is_empty() {
                SubHead { text: "Next time" }
                for t in x.tips.iter() { TipRow { key: "{t.card.id}{t.kind}", t: t.clone() } }
            }
            Note { "Every spend this month against the best of your cards for it, paid straight on the card, with the caps counted. ₹ is used here only to compare cards whose points are worth different amounts. Money sent to people isn't counted." }
        }
    }
}
#[component]
fn TipRow(t: TipM) -> Element {
    let got = t.from.iter().map(|f| match f.card { Some(c) => format!("{} on {}", earn_text(c, f.pts), f.short), None => "nothing (paid by bank or UPI)".into() }).collect::<Vec<_>>().join(", ");
    rsx! {
        div { class: "tip",
            div { class: "ic ic-warn", Icon { name: "spark".to_string() } }
            div { class: "grow",
                div { class: "tip-t", {format!("{}, use {}", if t.kind == "other" { "For other spends".to_string() } else { format!("For {}", t.kind_name.to_lowercase()) }, t.short)} }
                div { class: "tip-d", "It would have earned {earn_text(t.card, t.best_pts)} on {plural(t.n as i64, \"spend\")} ({rs(t.amt)}). You got {got}." }
            }
            div { class: "r-right", div { class: "r-val t-warn", "+{rs(t.gap)}" } div { class: "r-sub", "more" } }
        }
    }
}

/* ---------------- your next card ---------------- */
#[component]
fn NextCard(m: RewardsModel) -> Element {
    let x = &m.next;
    let rows: Vec<_> = x.rows.iter().filter(|r| r.net > 0.0).take(4).cloned().collect();
    let basis = if x.basis == "months" { format!("your last {}", plural(x.n as i64, "full month")) } else { "this month so far".into() };
    rsx! {
        Panel { title: "Your next card", i: 6,
            Note { "What each card open to you would earn in a year on {basis} of spending, counting only the spends where it beats your cards. The ₹ under it is that extra, after the card's yearly fee." }
            if rows.is_empty() { Note { "None of the cards open to you would beat yours after the fee." } } else {
                div { class: "rows",
                    for r in rows.iter() {
                        Row { key: "{r.card.id}", icon: rsx! { Ic { name: "cards" } }, title: r.card.name(),
                            detail: format!("{}{}", if r.top.is_empty() { String::new() } else { format!("Wins on {} · ", r.top.join(" and ")) }, if r.waived { "fee waived by the spending".to_string() } else if r.fee != 0.0 { format!("fee {}", rs(r.fee)) } else { "no fee".into() }),
                            value: format!("+{}", earn_text(r.card, if r.card.unit == "cashback" { r.year } else { r.pts_year })),
                            sub: format!("a year · {}{}{}", if r.card.unit == "cashback" && r.fee == 0.0 { "" } else { "≈ " }, rs(r.net), if r.fee != 0.0 && !r.waived { " after fee" } else { "" }), tone: "pos" }
                    }
                }
            }
        }
    }
}

/* ---------------- milestones ---------------- */
#[component]
fn Goals(m: RewardsModel) -> Element {
    if m.goals.is_empty() { return rsx! {} }
    rsx! {
        Panel { title: "Milestones and fee waivers", kind: "w", i: 8,
            for (i, g) in m.goals.iter().enumerate() {
                { let p = (g.done / g.target * 100.0).min(100.0); let left = (g.target - g.done).max(0.0); rsx! {
                    div { key: "{g.g}{g.what}", class: "capbar", style: if i > 0 { "margin-top:14px" } else { "margin-top:2px" },
                        div { class: "cb-h", span { class: "grow", "{cap(&g.what)}" } span { class: if left > 0.0 { "t-soft2" } else { "t-pos" }, if left > 0.0 { "{rs(left)} to go" } else { "Reached" } } }
                        div { class: "cb-s", {format!("{} · {} of {}{}{}", g.short, rs(g.done), rs(g.target), if g.per == "quarter" { " this quarter" } else { " in the last 12 months" }, if g.add_on { " (the main card's spending counts too)" } else { "" })} }
                        div { class: "bar", i { style: format!("width:{}%;background:{}", p, if left > 0.0 { "var(--accent)" } else { "var(--pos)" }) } }
                    }
                } }
            }
        }
    }
}

/* ---------------- how it counts ---------------- */
#[component]
fn Rupees(value: f64, label: String, ondone: EventHandler<Option<f64>>) -> Element {
    let mut text = use_signal(|| None::<String>);
    let shown_v = text().unwrap_or_else(|| format!("{}", round(value * 100.0) / 100.0));
    rsx! {
        span { class: "rupees", span { class: "t-soft", "₹" }
            input { class: "amtf small", inputmode: "decimal", aria_label: "{label}", value: "{shown_v}", onfocus: move |_| text.set(Some(format!("{}", round(value * 100.0) / 100.0))),
                oninput: move |e| text.set(Some(e.value().chars().filter(|c| c.is_ascii_digit() || *c == '.').collect())),
                onblur: move |_| { let t = text().unwrap_or_default(); text.set(None); let v = money_core::engine::parse_float(&t); if v.is_finite() && (0.0..=10.0).contains(&v) { ondone.call(Some(round(v * 100.0) / 100.0)); } else if t.is_empty() { ondone.call(None); } } }
        }
    }
}
#[component]
fn Prefs(m: RewardsModel) -> Element {
    let rb = rulebook();
    let p = &m.prefs;
    let mut open = use_signal(|| false);
    let accor = eng(|e| e.rew_partner_value("accor"));
    let checked = time::parse_iso(&rb.rew_checked).map(time::fmt_y).unwrap_or_default();
    let srcs: Vec<(String, String)> = rb.rew_sources.values().map(|v| (v["name"].as_str().unwrap_or("").to_string(), v["at"].as_str().unwrap_or("").to_string())).collect();
    let set = |k: &'static str, v: Option<Value>| act(|e| e.set_rew(k, v));
    rsx! {
        Panel { title: "How it counts", kind: "w", i: 9,
            Line { label: "I have Amazon Prime", sub: "Amazon Pay ICICI pays 5% on Amazon with Prime, 3% without",
                Switch { on: p.prime, label: "I have Amazon Prime", onchange: move |v: bool| set("prime", if v { None } else { Some(Value::Bool(false)) }) } }
            Line { label: "An Air India point is worth", sub: "in rupees, for one Maharaja Club point",
                Rupees { value: p.ai, label: "An Air India point in rupees", ondone: move |v: Option<f64>| set("ai", v.map(Value::from)) } }
            Line { label: "A KrisFlyer mile is worth", sub: "in rupees, for one Singapore Airlines mile",
                Rupees { value: p.kf, label: "A KrisFlyer mile in rupees", ondone: move |v: Option<f64>| set("kf", v.map(Value::from)) } }
            Note { "An Accor point is worth {rs(accor)} (2,000 take €40 off a stay). Cards are ranked by the better of cash and miles." }
            Note { "Card rules were checked on {checked}. Banks change them often, a shop can be filed under a different kind of spending than you'd expect, and SmartBuy's daily brand deals aren't included. This is arithmetic to plan with, not financial advice." }
            button { class: "more", onclick: move |_| open.set(!open()), span { if open() { "Show less" } else { "Where the numbers come from" } } Icon { name: "down".to_string(), size: 14.0, sw: 2.4 } }
            if open() { for (i, (n, a)) in srcs.into_iter().enumerate() { p { key: "{i}", class: "src-line", "{n} ({a})" } } }
        }
    }
}

/* ---------------- the web check ---------------- */
/// One answer per question as read (a correction under "Not what you meant?" asks again).
fn web_key(q: &str, sp: &Spend) -> String { format!("{}|{}|{:?}|{:?}|{}|{}|{:?}", q.trim().to_lowercase(), sp.kind, sp.shop, sp.amt, sp.online, sp.intl, sp.not) }
thread_local! { static WEB: RefCell<HashMap<String, Value>> = RefCell::new(HashMap::new()); }

/// "Check on the web": the app function searches the web for today's terms of your cards on this spend and an AI reads
/// them (Tavily + Gemini, both on free plans), then this shows its pick next to the app's own sum, with the pages it
/// read. Only when you tap it (each check uses a little of the free allowance); the answer is kept for the session.
#[component]
fn WebCheck(q: String, res: Search) -> Element {
    let rb = rulebook();
    let sp = res.sp.clone();
    let key = web_key(&q, &sp);
    let k0 = key.clone();
    let mut state = use_signal(move || WEB.with(|w| w.borrow().get(&k0).cloned()).map(|v| ("done".to_string(), v)).unwrap_or_else(|| ("idle".to_string(), Value::Null)));
    let understood = [Some(rb.kind(&sp.kind).name.clone()), sp.shop.as_ref().map(|_| format!("at {}", shop_name(&sp.shop))),
        Some(match sp.amt { Some(a) if a > 0.0 => format!("₹{}", locale_in(round(a))), _ => "₹1,000 (no amount given)".into() }),
        Some(if sp.intl { "in a foreign currency".into() } else if sp.online { "online".into() } else { "in a shop".into() }), not_text(&sp.not)]
        .into_iter().flatten().collect::<Vec<_>>().join(" · ");
    let mut cards: Vec<Value> = res.yours.iter().map(|y| serde_json::json!({ "name": y.card.name(), "short": y.short, "addOn": y.add_on })).collect();
    cards.extend(res.unknown.iter().map(|u| serde_json::json!({ "name": u.short, "short": u.short, "addOn": u.add_on })));
    let app = res.top.as_ref().and_then(|t| t.best.as_ref().map(|b| serde_json::json!({ "card": t.card.name(), "how": way_text(Some(b)), "earn": earn_text(t.card, b.pts),
        "value": round(b.net), "rate": b.rate, "notes": b.notes })));
    let go = move |_| {
        if *DEMO.read() { state.set(("err".into(), Value::from("The demo doesn't search the web."))); return; }
        let (key, body) = (key.clone(), serde_json::json!({ "action": "rew-web", "text": q.chars().take(300).collect::<String>(), "understood": understood, "cards": cards, "app": app }));
        state.set(("busy".into(), Value::Null));
        haptic("tap");
        dioxus::core::spawn_forever(async move {
            let Some(s) = fresh().await else { state.set(("err".into(), Value::from("Sign in again to check the web."))); return; };
            match crate::api::call_app(&s, body).await {
                Ok((200, o)) if o.get("ok") == Some(&Value::Bool(true)) => { WEB.with(|w| w.borrow_mut().insert(key, o.clone())); haptic("confirm"); state.set(("done".into(), o)); }
                Ok((200, o)) => {
                    let why = match o.get("reason").and_then(|r| r.as_str()).unwrap_or("") {
                        "no-key" => "The web check isn't switched on yet: it needs two free keys added to the app's server.",
                        "busy" => "Gemini's free plan is busy for a moment. Try again in a minute.",
                        "no-results" => "The web search found nothing on this. Try naming the card or the shop.",
                        "no-cards" => "Add your cards first (Settings → Your banks and cards).",
                        _ => "The web check didn't work this time. Try again.",
                    };
                    haptic("error"); state.set(("err".into(), Value::from(why)));
                }
                _ => { haptic("error"); state.set(("err".into(), Value::from("Couldn't reach the app's server. Check your connection."))); }
            }
        });
    };
    let (st, v) = state();
    let err = v.as_str().unwrap_or("").to_string();
    let agree = v["agree"].as_bool() == Some(true);
    rsx! {
        section { class: "panel k-w rise web", style: "--i:3",
            div { class: "panel-head", h2 { class: "grow", "From the web" } if st == "done" { span { class: if agree { "badge b-pos" } else { "badge b-warn" },
                if agree { "Agrees with the app" } else { "Differs from the app" } } } }
            match st.as_str() {
                "idle" => rsx! {
                    Note { "Card terms change often. Check today's terms on the web: an AI reads the banks' pages and reviews for your cards and this spend, and says which card it would use." }
                    div { style: "margin-top:10px", button { class: "btn small b-solid", onclick: go, Icon { name: "search".to_string(), size: 16.0 } span { "Check on the web" } } }
                },
                "busy" => rsx! { div { class: "web-busy", i { class: "boot-dot" } span { "Searching the web and reading your cards' terms… about 10 seconds" } } },
                "err" => rsx! {
                    Note { tone: "warn", "{err}" }
                    div { style: "margin-top:10px", button { class: "btn small b-ghost", onclick: go, "Try again" } }
                },
                _ => rsx! { WebAnswer { v: v.clone() } },
            }
        }
    }
}

#[component]
fn WebAnswer(v: Value) -> Element {
    let s = |x: &Value| x.as_str().unwrap_or("").to_string();
    let b = &v["best"];
    let (card, how, earn) = (s(&b["card"]), s(&b["how"]), s(&b["earn"]));
    let value = b["value"].as_f64().filter(|x| *x > 0.0 && !earn.contains('₹')).map(|x| format!(" ≈ {}", rs(x))).unwrap_or_default();
    let rate = b["rate"].as_f64().filter(|x| *x > 0.0).map(|x| format!(" ({}%)", (x * 10.0).round() / 10.0)).unwrap_or_default();
    let why = s(&v["why"]);
    let others: Vec<(String, String, String)> = v["others"].as_array().cloned().unwrap_or_default().iter()
        .map(|o| { let e = s(&o["earn"]); (s(&o["card"]), s(&o["note"]), format!("{}{}", e, o["value"].as_f64().filter(|x| *x > 0.0 && !e.contains('₹')).map(|x| format!(" · {}", rs(x))).unwrap_or_default())) })
        .filter(|o| !o.0.is_empty()).collect();
    let watch: Vec<String> = v["watch"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let host = |u: &str| u.split("//").nth(1).unwrap_or(u).split('/').next().unwrap_or("").trim_start_matches("www.").to_string();
    let sources: Vec<(String, String, String)> = v["sources"].as_array().cloned().unwrap_or_default().iter().map(|x| {
        let url = s(&x["url"]);
        let meta = format!("{}{}", host(&url), x["date"].as_str().map(|d| format!(" · {}", d.chars().take(10).collect::<String>())).unwrap_or_default());
        (url, s(&x["title"]), meta)
    }).filter(|x| x.0.starts_with("http")).collect();
    rsx! {
        div { class: "web-best",
            div { class: "web-card", "{card}" }
            if !how.is_empty() { div { class: "web-how", "{how}" } }
            div { class: "web-earn", b { "{earn}" } span { "{value}{rate}" } }
        }
        if !why.is_empty() { p { class: "web-why", "{why}" } }
        if !others.is_empty() {
            div { class: "rows", style: "margin-top:8px",
                for (i, (c, note, val)) in others.into_iter().enumerate() { Row { key: "{i}", title: c, detail: note, value: val, soft: true } }
            }
        }
        for (i, w) in watch.into_iter().enumerate() { Note { key: "w{i}", tone: "warn", "{w}" } }
        if !sources.is_empty() {
            div { class: "web-src",
                div { class: "u-l", "From these pages" }
                for (i, (url, title, meta)) in sources.into_iter().enumerate() {
                    a { key: "{i}", href: "{url}", target: "_blank", rel: "noopener", class: "web-link", span { class: "web-t", "{title}" } span { class: "web-h", "{meta}" } }
                }
            }
        }
        p { class: "web-foot", "Read from the web by an AI just now. It can be wrong: check the bank's own page before a big spend." }
    }
}
