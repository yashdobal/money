//! Bank SMS, in the Android app: when you turn it on, Money reads your banks' text messages
//! (only messages from bank senders; the app itself filters them, android/…/Sms.kt) so a payment shows the moment the
//! SMS lands, before the bank's email. Each one waits in Activity, marked "from SMS", until the email-based transaction
//! for it appears (same direction, amount within ₹1, within a day and a half), then drops away so nothing counts twice.
//! "Count them straight away" puts the waiting ones into every figure at once; the email takes its place when it comes.
//! Nothing read from SMS is sent anywhere: it stays in this app on the phone.

use crate::lock::{call, in_app};
use crate::state::*;
pub use money_core::sms::Item;
use money_core::sms::{matched, parse, shaped};
use money_core::shape::Tx;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use wasm_bindgen::JsValue;

const DAY: i64 = 86_400_000;
const KEY: &str = "money-rs-sms";
const ON: &str = "money-rs-sms-on";
const FIRST: &str = "money-rs-sms-first";

#[derive(Default, Serialize, Deserialize)]
struct Store { #[serde(default)] last: i64, #[serde(default)] items: Vec<Item>, #[serde(default)] hidden: Vec<String> }

fn read() -> Store { ls_get(KEY).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default() }
fn write(s: &Store) { ls_set(KEY, &serde_json::to_string(s).unwrap_or_default()); }

/* ---------------- on or off ---------------- */
/// This Android app can read SMS (an older app has no SMS reading).
/// (The Android app comes as two APKs: the one that can read SMS says so; the plain one answers "unsupported".)
pub fn supported() -> bool {
    in_app() && web_sys::window().and_then(|w| js_sys::Reflect::get(&w, &"AndroidBridge".into()).ok())
        .map(|b| js_sys::Reflect::has(&b, &"smsState".into()).unwrap_or(false)).unwrap_or(false)
        && permission() != "unsupported"
}
/// The plain APK (it has no SMS reading; the -sms APK has).
pub fn plain_apk() -> bool { in_app() && permission() == "unsupported" }
/// Android's answer for SMS ("granted", "ask", "blocked"), asked at most every two seconds: screens ask often.
thread_local! { static PERM: std::cell::RefCell<(f64, String)> = const { std::cell::RefCell::new((0.0, String::new())) }; }
fn permission() -> String {
    let now = js_sys::Date::now();
    if let Some(p) = PERM.with(|p| { let p = p.borrow(); if now - p.0 < 2000.0 { Some(p.1.clone()) } else { None } }) { return p; }
    let v = call("smsState", &[]).and_then(|v| v.as_string()).unwrap_or_default();
    PERM.with(|p| *p.borrow_mut() = (now, v.clone()));
    v
}
pub fn enabled() -> bool { ls_get(ON).as_deref() == Some("1") && supported() && permission() == "granted" }
/// The waiting SMS payments count in your figures straight away.
pub fn counting() -> bool { ls_get(FIRST).as_deref() == Some("1") && enabled() }

/// Settings → Read bank SMS. Turning it on asks Android first: the answer comes back through the "native" event
/// (answered()). Returns a line for a toast.
pub fn set_enabled(on: bool) -> &'static str {
    if !on {
        ls_del(ON); ls_del(KEY); ls_del(FIRST);
        inject();
        return "Bank SMS off";
    }
    PERM.with(|p| p.borrow_mut().0 = 0.0);
    match call("askSms", &[]).and_then(|v| v.as_string()).as_deref() {
        Some("granted") => { ls_set(ON, "1"); scan(); "Bank SMS on: payments from SMS show in Activity" }
        Some("asking") => "",
        Some("settings") => "Allow SMS for Money in Android's settings (Permissions → SMS), then turn this on again.",
        _ => "This copy of Money can't read SMS: install the money-…-sms.apk from the latest release.",
    }
}
/// Android's answer to the question set_enabled asked.
pub fn answered(granted: bool) {
    PERM.with(|p| p.borrow_mut().0 = 0.0);
    if granted { ls_set(ON, "1"); scan(); toast("Bank SMS on: payments from SMS show in Activity", ""); }
    else { toast("SMS stays off", "warn"); }
    bump();
}
pub fn set_counting(on: bool) {
    if on { ls_set(FIRST, "1") } else { ls_del(FIRST) }
    inject();
}

/* ---------------- reading new messages ---------------- */
/// Reads new messages (on opening the app, coming back to it, and refreshing), then puts them where they show.
pub fn scan() {
    if !enabled() { return; }
    let mut st = read();
    let now = js_sys::Date::now() as i64;
    let keep_from = now - 3 * DAY;
    let since = st.last.max(keep_from);
    let msgs: Vec<Value> = call("readSms", &[JsValue::from_f64(since as f64), JsValue::from(300)])
        .and_then(|v| v.as_string()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut newest = since;
    eng(|e| {
        for m in &msgs {
            let (a, b, d) = (m["address"].as_str().unwrap_or(""), m["body"].as_str().unwrap_or(""), m["date"].as_i64().unwrap_or(0));
            newest = newest.max(d);
            if let Some(p) = parse(e, a, b, d) { if !st.items.iter().any(|x| x.id == p.id) { st.items.push(p); } }
        }
    });
    st.last = newest;
    st.items.retain(|x| x.ts > keep_from);
    if st.items.len() > 500 { let cut = st.items.len() - 500; st.items.drain(..cut); }
    if st.hidden.len() > 200 { let cut = st.hidden.len() - 200; st.hidden.drain(..cut); }
    write(&st);
    inject();
}

/// The SMS payments still waiting for their email, newest first.
pub fn pending() -> Vec<Item> {
    if !enabled() { return vec![]; }
    let st = read();
    let items: Vec<Item> = st.items.into_iter().filter(|x| !st.hidden.contains(&x.id)).collect();
    let m = eng(|e| matched(&items, &e.tx));
    let mut out: Vec<Item> = items.into_iter().filter(|x| !m.contains(&x.id)).collect();
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out
}
pub fn pending_total() -> f64 { pending().iter().filter(|x| x.dir == "out").map(|x| x.amt).sum() }
/// "Not mine": hides it for good.
pub fn dismiss(id: &str) {
    let mut st = read();
    st.hidden.push(id.to_string());
    write(&st);
    inject();
}

/// With "Count them straight away" on, the waiting ones join your transactions (else they're taken out again); every
/// figure is then worked out afresh. After each load too, since a load starts the transactions over.
pub fn inject() {
    let add: Vec<Tx> = if counting() { pending().iter().filter(|x| x.alias.is_some()).filter_map(shaped).collect() } else { vec![] };
    let had = eng(|e| e.tx.iter().any(|t| t.sms));
    if add.is_empty() && !had { bump(); return; }
    eng_mut(|e| {
        e.tx.retain(|t| !t.sms);
        e.tx.extend(add);
        e.resolve_payments();
    });
    bump();
}

/// One waiting payment (the SMS sheet).
pub fn find(id: &str) -> Option<Item> { pending().into_iter().find(|x| x.id == id) }
