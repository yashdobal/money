//! Settings (rn/src/screens/Settings.js): appearance, your data, sync, account; and the sheets for payee rules, your
//! banks and cards (bringing in a setup) and bank balances.

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;
use money_core::fmt::money;
use money_core::time;
use serde_json::Value;

#[component]
fn Group(title: String, i: usize, children: Element) -> Element {
    rsx! { div { class: "rise", style: "--i:{i}", h3 { class: "set-h", "{title}" } div { class: "set-list", {children} } } }
}
/// A white card in its group's tray: an icon, a title and a line, then a switch, a chevron or nothing.
#[component]
fn SetRow(icon: String, title: String, #[props(default)] detail: String, #[props(default)] right: Option<Element>, #[props(default)] danger: bool,
    #[props(default)] onclick: Option<EventHandler<MouseEvent>>, #[props(default)] children: Element) -> Element {
    let chevron = right.is_none() && onclick.is_some();
    let inner = rsx! {
        div { class: "set-in",
            span { class: if danger { "set-ic t-alert" } else { "set-ic" }, Icon { name: icon.clone() } }
            div { class: "grow", div { class: if danger { "set-t t-alert" } else { "set-t" }, "{title}" } if !detail.is_empty() { div { class: "set-d", "{detail}" } } }
            {right}
            if chevron { span { class: "chev", Icon { name: "chev".to_string(), size: 18.0 } } }
        }
        {children}
    };
    match onclick {
        Some(h) => rsx! { button { class: "set-row press", onclick: move |e| h.call(e), {inner} } },
        None => rsx! { div { class: "set-row", {inner} } },
    }
}

fn theme_now() -> String { ls_get("money-rs-theme").unwrap_or_else(|| "auto".into()) }
fn set_theme(t: &str) {
    if let Some(w) = web_sys::window() {
        if let Ok(f) = js_sys::Reflect::get(&w, &"moneyTheme".into()) {
            if let Ok(f) = f.dyn_into::<js_sys::Function>() { let _ = f.call1(&w, &t.into()); }
        }
    }
}
use wasm_bindgen::JsCast;

/// Saves the CSV of every transaction to your downloads.
fn export_csv(name: &str, text: &str) -> bool {
    let Some(doc) = web_sys::window().and_then(|w| w.document()) else { return false };
    let parts = js_sys::Array::new();
    parts.push(&format!("\u{feff}{}", text).into());
    let o = web_sys::BlobPropertyBag::new();
    o.set_type("text/csv");
    let Ok(blob) = web_sys::Blob::new_with_str_sequence_and_options(&parts, &o) else { return false };
    let Ok(url) = web_sys::Url::create_object_url_with_blob(&blob) else { return false };
    let Ok(a) = doc.create_element("a") else { return false };
    let a: web_sys::HtmlAnchorElement = a.unchecked_into();
    a.set_href(&url); a.set_download(name);
    a.click();
    let _ = web_sys::Url::revoke_object_url(&url);
    true
}

#[component]
pub fn Settings() -> Element {
    let _ = VER();
    let mut theme = use_signal(theme_now);
    let (rules, banks, groups, bb, bank_names, last_run, notes_ok, n_tx, ago) = eng(|e| (
        e.cat_rules.len(), e.banks.len(), e.groups.len(), e.bank_balance(), e.bank_names(), e.last_run, e.notes_ok, e.tx.len() + e.manual.len(),
        e.last_run.map(|t| e.ago(t)).unwrap_or_default()));
    let s = SESSION();
    let demo = DEMO();
    let hidden = HIDDEN();
    let bal_detail = match &bb { Some(b) => b.parts.iter().map(|p| format!("{}{}", p.name, if p.set { format!(" {}", if hidden { "₹••••".into() } else { money(p.bal) }) } else { " not set".into() })).collect::<Vec<_>>().join(" · "),
        None => if banks > 0 { format!("{}, not set yet", bank_names) } else { "add your banks first".into() } };
    let last = last_run.map(|t| { let p = time::parts(t); format!("{} · {} {}, {}", ago, p.d, ym_short(&time::ym_of(t)), Engine_clock(t)) }).unwrap_or_else(|| "not yet".into());
    rsx! {
        div { class: "page",
            Group { title: "Appearance", i: 0,
                SetRow { icon: "palette", title: "Theme", right: rsx! { Seg { value: theme(), onchange: move |v: String| { set_theme(&v); theme.set(v); }, options: vec![opt("auto", "Auto"), opt("light", "Light"), opt("dark", "Dark")] } } }
                SetRow { icon: "eyeOff", title: "Hide amounts", detail: "shows dots in place of every amount until you tap the eye",
                    right: rsx! { Switch { on: hidden, label: "Hide amounts", onchange: move |v| set_hidden(v) } } }
            }
            Security {}
            Group { title: "Your data", i: 1,
                SetRow { icon: "download", title: "Export to CSV", detail: format!("{}, for a spreadsheet", plural(n_tx as i64, "transaction")), onclick: move |_| {
                    let (name, text) = eng(|e| (format!("money-{}.csv", time::iso(e.today())), e.csv_text()));
                    if export_csv(&name, &text) { toast("Saved to your downloads", ""); } else { toast("Couldn't save the file", "warn"); }
                } }
                SetRow { icon: "mail", title: "Read emails now", detail: "ask the collector to check Gmail", onclick: move |_| { toast("Asking the collector to check Gmail…", ""); dioxus::core::spawn_forever(async { refresh().await; }); } }
                SetRow { icon: "rule", title: "Saved payee rules", detail: if rules > 0 { plural(rules as i64, "rule") } else { "none yet".to_string() }, onclick: move |_| *SHEET.write() = Some("rules".into()) }
                SetRow { icon: "card", title: "Your banks and cards", detail: if banks > 0 || groups > 0 { format!("{} · {}", plural(banks as i64, "bank"), plural(groups as i64, "card account")) } else { "not set yet".to_string() },
                    onclick: move |_| *SHEET.write() = Some("setup".into()) }
                SetRow { icon: "bank", title: "Bank balances", detail: bal_detail, onclick: move |_| *SHEET.write() = Some(if banks > 0 { "balance".into() } else { "setup".into() }) }
                SetRow { icon: "salary", title: "Salary & fixed payments", detail: "offer letter, your split, EMIs", onclick: move |_| *SHEET.write() = Some("salary".into()) }
            }
            Group { title: "Sync", i: 2,
                SetRow { icon: "cloud", title: "Emails last read", detail: last }
                SetRow { icon: "db", title: "Database", detail: if notes_ok { "up to date" } else if demo { "the demo" } else { "one update is needed for notes and payee rules" } }
                SetRow { icon: "refresh", title: "Last saved", detail: { let m = SAVE_MSG(); if m.is_empty() { "nothing changed yet".to_string() } else { m } } }
            }
            Group { title: "Account", i: 3,
                SetRow { icon: "user", title: if demo { "The demo (made-up data)".to_string() } else { s.as_ref().map(|s| s.email.clone()).unwrap_or("Signed in".into()) },
                    detail: format!("Money in Rust · engine {} · website", money_core::version()) }
                if !demo { SetRow { icon: "out", title: "Sign out", danger: true, onclick: move |_| { toast("Signing out…", ""); sign_out(); } } }
                SetRow { icon: "spark", title: "Open the current app", detail: "yash-money.pages.dev, while this one is being finished", onclick: move |_| {
                    if let Some(w) = web_sys::window() { let _ = w.location().set_href("https://yash-money.pages.dev"); }
                } }
            }
        }
    }
}
#[allow(non_snake_case)]
fn Engine_clock(t: i64) -> String { money_core::engine::Engine::clock_of(t) }

/* ---------------- the sheets ---------------- */
fn close() { *SHEET.write() = None; }

/// Your payee rules: each gives every payment to that payee its category.
#[component]
pub fn RulesSheet() -> Element {
    let _ = VER();
    let rules: Vec<(String, String)> = eng(|e| e.cat_rules.iter().map(|(k, v)| (k.clone(), v.clone())).collect());
    rsx! {
        h2 { class: "sheet-t", "Saved payee rules" }
        if rules.is_empty() { Note { "No rules yet. Open a transaction and turn on \"Always use this for …\" to add one." } } else {
            Note { "Each rule gives every payment to that payee its category, past and future. Remove one to go back to the category the alert came with." }
            div { class: "rows plain",
                for (k, c) in rules.into_iter() {
                    div { key: "{k}", class: "pay-line",
                        Row { icon: rsx! { CatIc { cat: c.clone() } }, title: k.clone(), detail: c.clone() }
                        button { class: "xbtn", aria_label: "Remove rule for {k}", onclick: { let k = k.clone(); move |_| { act(|e| e.del_rule(&k)); toast("Rule removed", ""); } }, Icon { name: "close".to_string(), size: 16.0 } }
                    }
                }
            }
        }
    }
}

/// Your bank balances: what each bank app shows right now.
#[component]
pub fn BalanceSheet() -> Element {
    let parts = eng(|e| match e.bank_balance() { Some(b) => b.parts, None => e.banks.iter().map(|b| e.account_balance(&b.key)).collect() });
    let mut vals = use_signal(|| std::collections::HashMap::<String, String>::new());
    let ps = parts.clone();
    rsx! {
        h2 { class: "sheet-t", "Your bank balances" }
        Note { "Enter what each bank app shows right now. Leave one empty to keep it as it is. After that, alerts keep them up to date." }
        for p in parts.into_iter() {
            Field { key: "{p.key}", label: format!("Balance in the {} app (₹)", p.name), numeric: true, value: vals().get(&p.key).cloned().unwrap_or_default(),
                placeholder: if p.set { format!("Now {} from alerts · set {}", shown(&exact_s(p.bal, "")), if p.since != 0.0 { time::fmt(p.since as i64) } else { String::new() }) } else { "Not set yet".to_string() },
                oninput: { let k = p.key.clone(); move |t: String| { vals.write().insert(k.clone(), t); } } }
        }
        div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
            let v = vals();
            let filled: Vec<_> = ps.iter().filter(|p| !v.get(&p.key).map(|x| x.trim().is_empty()).unwrap_or(true)).cloned().collect();
            if filled.is_empty() { return toast("Enter at least one balance.", "alert"); }
            for p in &filled { let m = act(|e| e.set_balance(&v[&p.key], &p.key)); if !m.is_empty() { return toast(m, "alert"); } }
            close();
            toast(if filled.len() > 1 { "Balances set".to_string() } else { format!("{} balance set", filled[0].name) }, "");
        }, "Set balance" } }
    }
}

/// A setup as text: JSON, or base64url of JSON (from a setup link).
pub fn decode_setup(t: &str) -> Option<Value> {
    let t = t.trim();
    if t.is_empty() { return None; }
    if let Ok(v) = serde_json::from_str::<Value>(t) { return Some(v); }
    let b: String = t.chars().map(|c| match c { '-' => '+', '_' => '/', c => c }).collect();
    let pad = "===".get(..(4 - b.len() % 4) % 4).unwrap_or("");
    let bin = web_sys::window()?.atob(&format!("{}{}", b, pad)).ok()?;
    let bytes: Vec<u8> = bin.chars().map(|c| c as u32 as u8).collect();
    serde_json::from_slice(&bytes).ok()
}

/// Your banks and cards, and bringing in a setup (pasted, or from a link).
#[component]
pub fn SetupSheet(#[props(default)] arg: String) -> Element {
    let _ = VER();
    let mut text = use_signal(String::new);
    let mut err = use_signal(String::new);
    let incoming = if !arg.is_empty() { decode_setup(&arg) } else { decode_setup(&text()) };
    let mine = eng(|e| e.profile.clone());
    let list_of = |p: &Value| -> Element {
        let banks: Vec<Value> = p.get("banks").and_then(|b| b.as_array()).cloned().unwrap_or_default();
        let groups: Vec<(String, Value)> = p.get("groups").and_then(|g| g.as_object()).map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        let s = |v: Option<&Value>| v.and_then(|x| x.as_str()).unwrap_or("").to_string();
        rsx! {
            div { class: "rows plain",
                for b in banks.iter() { Row { key: "b{s(b.get(\"key\"))}", icon: rsx! { Ic { name: "bank" } }, title: { let f = s(b.get("full")); if f.is_empty() { s(b.get("name")) } else { f } }, detail: "bank account" } }
                for (k, g) in groups.iter() {
                    Row { key: "g{k}", icon: rsx! { Ic { name: "card" } },
                        title: regex::Regex::new(r"\s*·\d{4}").unwrap().replace_all(&{ let x = s(g.get("short")); if x.is_empty() { k.clone() } else { x } }, "").to_string(),
                        detail: format!("{}bill on the {}, due {} days later", { let c = s(g.get("closed")); if c.is_empty() { String::new() } else { format!("closed {} · ", c) } },
                            time::ordinal(g.get("stmtDay").and_then(|x| x.as_f64()).unwrap_or(1.0) as i32), g.get("dueAfter").and_then(|x| x.as_f64()).filter(|x| *x != 0.0).unwrap_or(20.0) as i32) }
                }
            }
        }
    };
    if !arg.is_empty() || (!text().is_empty() && incoming.is_some()) {
        let Some(x) = incoming.filter(|x| x.get("profile").map(|p| p.is_object()).unwrap_or(false)) else { return rsx! { h2 { class: "sheet-t", "Your banks and cards" } Note { "This link doesn't hold a Money setup. Ask for a new one." } } };
        let plan = x.get("cfg").map(|c| c.get("offer").is_some() || c.get("rule").is_some() || c.get("planned").is_some()).unwrap_or(false);
        let p = x["profile"].clone();
        let x2 = x.clone();
        return rsx! {
            h2 { class: "sheet-t", "Your banks and cards" }
            Note { {format!("This sets your banks and cards{}. It's saved to your account, so your other devices get it too.", if plan { ", and fills in the salary figures you haven't set yet" } else { "" })} }
            {list_of(&p)}
            if p.get("family").and_then(|f| f.as_str()).map(|f| !f.is_empty()).unwrap_or(false) { div { class: "rows plain", Row { title: "Family share", detail: format!("goes to {}", p["family"].as_str().unwrap_or("")) } } }
            div { class: "actions", button { class: "btn b-solid big", onclick: move |_| {
                let m = act(|e| e.import_setup(&x2));
                if !m.is_empty() { err.set(m); return; }
                close(); toast("Your banks and cards are saved", "");
            }, "Save to my account" } }
            if !err().is_empty() { Note { tone: "alert", "{err}" } }
        };
    }
    let has = mine.get("groups").and_then(|g| g.as_object()).map(|o| !o.is_empty()).unwrap_or(false) || mine.get("banks").and_then(|b| b.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
    rsx! {
        h2 { class: "sheet-t", "Your banks and cards" }
        if has { {list_of(&mine)} } else { Note { "None yet. They come in with a setup: paste one below, or open the setup link you were sent." } }
        SubHead { text: "Bring in a setup" }
        Field { label: "Paste the setup text", value: text(), multiline: true, placeholder: "{{\"profile\": …}}", oninput: move |t| { text.set(t); err.set(String::new()); } }
        if !text().is_empty() && incoming.is_none() { Note { "That isn't a Money setup." } }
    }
}

/// The lock: the fingerprint lock inside the Android app, a 4-digit code in a browser.
#[component]
fn Security() -> Element {
    use crate::lock;
    let _ = VER();
    let mut after = use_signal(|| None::<i64>);
    if lock::in_app() {
        let info = lock::call_json("lockInfo").unwrap_or_default();
        let (avail, on) = (info["available"] == true, info["enabled"] == true);
        let a = after().unwrap_or(info["after"].as_i64().unwrap_or(0));
        return rsx! {
            Group { title: "Security", i: 1,
                SetRow { icon: "lock", title: "Fingerprint lock", detail: if avail { "asks for your fingerprint or phone PIN to open Money" } else { "set a screen lock on your phone first" },
                    right: rsx! { Switch { on, label: "Fingerprint lock", onchange: move |v: bool| { lock::call("setLock", &[wasm_bindgen::JsValue::from(v)]); } } } }
                if on { SetRow { icon: "refresh", title: "Lock after", right: rsx! { Seg { value: a.to_string(), onchange: move |v: String| { let n = v.parse().unwrap_or(0); lock::set_after(n); after.set(Some(n)); },
                    options: vec![opt("0", "Right away"), opt("60", "1 min"), opt("300", "5 min")] } } } }
            }
        };
    }
    let has = lock::has_pin();
    let a = after().unwrap_or(lock::after_sec());
    rsx! {
        Group { title: "Security", i: 1,
            SetRow { icon: "lock", title: "App lock code", detail: if has { "on · asked when you come back after being away" } else { "off" }, onclick: move |_| *SHEET.write() = Some("pin".into()) }
            if has { SetRow { icon: "refresh", title: "Ask again after", right: rsx! { Seg { value: a.to_string(), onchange: move |v: String| { let n = v.parse().unwrap_or(300); lock::set_after(n); after.set(Some(n)); },
                options: vec![opt("0", "Right away"), opt("60", "1 min"), opt("300", "5 min")] } } } }
        }
    }
}
