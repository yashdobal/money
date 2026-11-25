//! What the phone and the browser do for Money:
//!   inside the Android app: the home-screen widget gets the numbers the app has just worked out, the app gets its
//!     device key for its hourly background check, alerts are the app's own, bank SMS (sms.rs), and signing out
//!     clears all of it;
//!   in a browser: web push (host.js and sw.js), this browser's subscription saved to your account.
//! The Android app answers some asks later, through a "native" window event: {type: "notif" | "sms" | "lock", …}.

use crate::api;
use crate::lock::{call, call_json, in_app};
use crate::state::*;
use dioxus::prelude::*;
use serde_json::{json, Value};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

thread_local! {
    /// The widget: the last numbers sent (without the time), when, and the pending send.
    static WIDGET: RefCell<(String, f64, u64)> = const { RefCell::new((String::new(), 0.0, 0)) };
}

/* ---------------- the widget ---------------- */
/// Hands the home-screen widget the numbers the app has just worked out (the engine's widget model, the same the
/// server sends every hour), at most once every ten minutes unless they change. force: now, whatever was sent.
pub fn widget(force: bool) {
    if !in_app() || (*DEMO.peek() && !demo_build()) || !eng(|e| e.data_in) { return; }
    let g = WIDGET.with(|w| { let mut w = w.borrow_mut(); w.2 += 1; w.2 });
    dioxus::core::spawn_forever(async move {
        gloo_timers::future::TimeoutFuture::new(if force { 0 } else { 600 }).await;
        if WIDGET.with(|w| w.borrow().2) != g { return; }
        let mut w = eng_mut(|e| e.widget_model());
        if let Some(o) = w.as_object_mut() { o.insert("hide".into(), json!(*HIDDEN.peek())); }
        let key = { let mut k = w.clone(); if let Some(o) = k.as_object_mut() { o.remove("at"); } k.to_string() };
        let now = js_sys::Date::now();
        let (last, at) = WIDGET.with(|x| { let x = x.borrow(); (x.0.clone(), x.1) });
        if !force && key == last && now - at < 600_000.0 { return; }
        WIDGET.with(|x| { let mut x = x.borrow_mut(); x.0 = key; x.1 = now; });
        call("pushWidget", &[JsValue::from_str(&w.to_string())]);
    });
}

/* ---------------- after a load, on sign-out ---------------- */
/// After your data loads: the widget, the device key (once), bank SMS, and this browser's alert subscription.
pub fn loaded() {
    if *DEMO.peek() { return; }
    crate::sms::inject();
    crate::sms::scan();
    widget(true);
    if in_app() {
        if call("hasDeviceKey", &[]).and_then(|v| v.as_bool()) == Some(false) {
            dioxus::core::spawn_forever(async { register().await; });
        }
    } else {
        dioxus::core::spawn_forever(async { keep_subscription().await; });
    }
}
/// The Android app's key for its background check (supabase/functions/device): the widget's numbers every hour and
/// the alerts, without the app open. Also switches off this phone's browser alerts, so nothing arrives twice.
async fn register() {
    let Some(s) = fresh().await else { return };
    if let Ok((200, out)) = api::call_app(&s, json!({ "action": "register-device", "name": "Android app" })).await {
        if let Some(t) = out.get("token").and_then(|t| t.as_str()) { call("setDeviceKey", &[JsValue::from_str(t)]); }
    }
}
/// Signing out: the app forgets its device key, the widget, its alerts and the old app's sign-in.
pub fn signed_out() {
    if in_app() { call("signedOut", &[]); call("clearWidget", &[]); }
    WIDGET.with(|w| *w.borrow_mut() = (String::new(), 0.0, 0));
}

/// When the app comes back to the front: new bank SMS.
pub fn resumed() {
    if *PHASE.peek() == Phase::Ready && !*DEMO.peek() { crate::sms::scan(); }
}

/* ---------------- alerts ---------------- */
/// Where alerts stand here: "granted", "ask", "blocked" or "none" (this browser can't), and whether the phone mutes them.
pub fn alert_state() -> (String, bool) {
    if in_app() {
        let n = call_json("notifInfo").unwrap_or(Value::Null);
        let p = if n["permission"] == "granted" && n["enabled"] != false { "granted" } else if n["permission"] == "blocked" { "blocked" } else { "ask" };
        return (p.into(), n["muted"] == true);
    }
    let on = ls_get("money-push").as_deref() == Some("1");
    (push_call("state", &[JsValue::from_bool(on)]).and_then(|v| v.as_string()).unwrap_or_else(|| "none".into()), false)
}
fn push_call(f: &str, args: &[JsValue]) -> Option<JsValue> {
    let w = web_sys::window()?;
    let p = js_sys::Reflect::get(&w, &"moneyPush".into()).ok().filter(|p| p.is_object())?;
    let func: js_sys::Function = js_sys::Reflect::get(&p, &f.into()).ok()?.dyn_into().ok()?;
    func.apply(&p, &args.iter().cloned().collect::<js_sys::Array>()).ok()
}
async fn push_await(f: &str, args: &[JsValue]) -> String {
    let Some(p) = push_call(f, args).and_then(|v| v.dyn_into::<js_sys::Promise>().ok()) else { return "none".into() };
    wasm_bindgen_futures::JsFuture::from(p).await.ok().and_then(|v| v.as_string()).unwrap_or_default()
}
async fn save_subscription(sub: &str) -> Result<(), String> {
    let row: Value = serde_json::from_str(sub).map_err(|e| e.to_string())?;
    let s = fresh().await.ok_or("signed out")?;
    api::upsert(&s, "push_subscriptions", "endpoint", &json!({ "endpoint": row["endpoint"], "p256dh": row["p256dh"], "auth": row["auth"], "device_name": row["device_name"], "failures": 0 })).await
}
/// Keeps your account's copy of this browser's subscription fresh (endpoints can change).
async fn keep_subscription() {
    if ls_get("money-push").as_deref() != Some("1") { return; }
    let sub = push_await("current", &[]).await;
    if sub.starts_with('{') { let _ = save_subscription(&sub).await; }
}

/// The test alert (asking for permission the first time). The Android app may answer later ("asking"): native event.
pub async fn test_alert() {
    if in_app() {
        let r = call("testNotification", &[]).and_then(|v| v.as_string()).unwrap_or_default();
        if r != "asking" { say(&r); }
        return;
    }
    let r = push_await("enable", &[JsValue::from_str(&api::vapid_key())]).await;
    if !r.starts_with('{') { return say(&r); }
    if let Err(e) = save_subscription(&r).await { return say(&format!("error:{}", e)); }
    ls_set("money-push", "1");
    let delivered = match fresh().await { Some(s) => matches!(api::call_app(&s, json!({ "action": "test-push" })).await, Ok((200, ref o)) if o["delivered"].as_i64().unwrap_or(0) > 0 || o["delivered"] == true), None => false };
    say(if delivered { "shown" } else { "saved" });
    bump();
}
/// What the test alert's answer means, as a toast.
pub fn say(r: &str) {
    let here = if in_app() { "Money" } else { "this site" };
    match r {
        "shown" => toast("Test alert sent", ""),
        "saved" => toast("Alerts are on. They'll arrive here.", ""),
        "denied" => toast("Alerts stay off. You can turn them on here any time.", "warn"),
        "none" => toast("This browser can't receive alerts. On Android, use Chrome.", "warn"),
        "" => {}
        r if r.starts_with("settings:permission") || r == "blocked" => toast(format!("Allow notifications for {}, then come back.", here), "warn"),
        r if r.starts_with("settings:off") => toast("Notifications are off for Money. Turn them on, then come back.", "warn"),
        r if r.starts_with("settings:channel") => toast("Money's alerts are muted. Turn them on, then come back.", "warn"),
        r if r.starts_with("error:") => toast(format!("Couldn't turn alerts on: {}", &r[6..]), "warn"),
        _ => {}
    }
    bump();
}

/* ---------------- the Android app's answers ---------------- */
/// Listens for what the Android app says back, and for the app coming back to the front.
pub fn start() {
    let rt = dioxus::core::Runtime::current();
    let rt2 = rt.clone();
    let f = Closure::<dyn Fn(web_sys::CustomEvent)>::new(move |e: web_sys::CustomEvent| {
        let d = e.detail();
        let get = |k: &str| js_sys::Reflect::get(&d, &k.into()).ok();
        let kind = get("type").and_then(|v| v.as_string()).unwrap_or_default();
        rt.in_scope(dioxus::prelude::ScopeId::ROOT, || match kind.as_str() {
            "notif" => say(&get("status").and_then(|v| v.as_string()).unwrap_or_default()),
            "sms" => crate::sms::answered(get("granted").and_then(|v| v.as_bool()).unwrap_or(false)),
            _ => {}
        });
    });
    if let Some(w) = web_sys::window() { let _ = w.add_event_listener_with_callback("native", f.as_ref().unchecked_ref()); }
    f.forget();
    let v = Closure::<dyn Fn()>::new(move || {
        let hidden = web_sys::window().and_then(|w| w.document()).map(|d| d.hidden()).unwrap_or(true);
        if !hidden { rt2.in_scope(dioxus::prelude::ScopeId::ROOT, resumed); }
    });
    if let Some(d) = web_sys::window().and_then(|w| w.document()) { let _ = d.add_event_listener_with_callback("visibilitychange", v.as_ref().unchecked_ref()); }
    v.forget();
}
