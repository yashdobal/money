//! The lock (rn/src/pin.js, native/lock.web.js). In a browser: a 4-digit code, like a phone PIN, asked when you come
//! back after being away; kept only in this browser and only as a salted PBKDF2-SHA-256 hash. Five wrong tries turn
//! it off and sign you out. Inside the Android app the app's own fingerprint lock stands in front of the page, and
//! Settings switches it through the app (window.AndroidBridge).

use crate::kit::*;
use crate::state::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use dioxus::prelude::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

const PIN_KEY: &str = "money-pin";
const PIN_TRIES: &str = "money-pin-tries";
const ACTIVE: &str = "money-active";
const AFTER: &str = "money-lock-after";
pub const MAX_TRIES: u32 = 5;

/// The page is locked (a browser with a code, after being away).
pub static LOCKED: GlobalSignal<bool> = Signal::global(|| false);

fn now() -> f64 { js_sys::Date::now() }
/// Inside the Android app.
pub fn in_app() -> bool { bridge().is_some() }
fn bridge() -> Option<JsValue> { web_sys::window().and_then(|w| js_sys::Reflect::get(&w, &"AndroidBridge".into()).ok()).filter(|b| !b.is_undefined() && !b.is_null()) }
/// window.AndroidBridge[f](...args)
pub fn call(f: &str, args: &[JsValue]) -> Option<JsValue> {
    let b = bridge()?;
    let func: js_sys::Function = js_sys::Reflect::get(&b, &f.into()).ok()?.dyn_into().ok()?;
    func.apply(&b, &args.iter().cloned().collect::<js_sys::Array>()).ok()
}
pub fn call_json(f: &str) -> Option<serde_json::Value> { call(f, &[])?.as_string().and_then(|s| serde_json::from_str(&s).ok()) }

pub fn has_pin() -> bool { ls_get(PIN_KEY).is_some() }
pub fn touch() { ls_set(ACTIVE, &format!("{}", now() as i64)); }
pub fn after_sec() -> i64 { match ls_get(AFTER).and_then(|v| v.parse::<i64>().ok()) { Some(v) if [0, 60, 300].contains(&v) => v, _ => 300 } }
pub fn set_after(s: i64) { if in_app() { call("setLockAfter", &[JsValue::from(s as i32)]); } else { ls_set(AFTER, &s.to_string()); } }
fn idle() -> bool {
    has_pin() && now() - ls_get(ACTIVE).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) >= (after_sec().max(1) * 1000) as f64
}
fn hash(pin: &str, salt: &[u8], iter: u32) -> String {
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(pin.as_bytes(), salt, iter, &mut out);
    B64.encode(out)
}
pub fn set_pin(pin: &str) {
    let mut salt = [0u8; 16];
    if let Some(c) = web_sys::window().and_then(|w| w.crypto().ok()) { let _ = c.get_random_values_with_u8_array(&mut salt); }
    let iter = 150000;
    ls_set(PIN_KEY, &serde_json::json!({ "v": 1, "salt": B64.encode(salt), "iter": iter, "hash": hash(pin, &salt, iter) }).to_string());
    ls_del(PIN_TRIES);
    touch();
}
pub fn clear_pin() { ls_del(PIN_KEY); ls_del(PIN_TRIES); }
pub enum Check { Ok, Left(u32), Off }
pub fn check_pin(pin: &str) -> Check {
    let p: Option<serde_json::Value> = ls_get(PIN_KEY).and_then(|s| serde_json::from_str(&s).ok());
    if let Some(p) = p {
        let salt = B64.decode(p["salt"].as_str().unwrap_or("")).unwrap_or_default();
        if hash(pin, &salt, p["iter"].as_u64().unwrap_or(150000) as u32) == p["hash"].as_str().unwrap_or("") { ls_del(PIN_TRIES); touch(); return Check::Ok; }
    }
    let n = ls_get(PIN_TRIES).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0) + 1;
    if n < MAX_TRIES { ls_set(PIN_TRIES, &n.to_string()); return Check::Left(MAX_TRIES - n); }
    clear_pin();
    Check::Off
}
pub fn obvious(c: &str) -> bool { c.chars().all(|x| Some(x) == c.chars().next()) || ["1234", "4321", "0123", "3210", "1212", "6969", "2580", "0852"].contains(&c) }

/// At start: locked if you've been away; then keep "when you were last here" up to date, and lock again when the page
/// comes back after long enough.
pub fn start() {
    if in_app() { listen_native(); return; }
    if idle() { *LOCKED.write() = true; } else { touch(); }
    spawn(async {
        loop {
            gloo_timers::future::TimeoutFuture::new(30000).await;
            let hidden = web_sys::window().and_then(|w| w.document()).map(|d| d.hidden()).unwrap_or(false);
            if !hidden && !*LOCKED.peek() { touch(); }
        }
    });
    let rt = dioxus::core::Runtime::current();
    let f = Closure::<dyn Fn()>::new(move || {
        rt.in_scope(ScopeId::ROOT, || {
            let hidden = web_sys::window().and_then(|w| w.document()).map(|d| d.hidden()).unwrap_or(false);
            if hidden { if !*LOCKED.peek() { touch(); } } else if idle() && !*LOCKED.peek() { *SHEET.write() = None; *LOCKED.write() = true; }
        })
    });
    if let Some(d) = web_sys::window().and_then(|w| w.document()) { let _ = d.add_event_listener_with_callback("visibilitychange", f.as_ref().unchecked_ref()); }
    f.forget();
}
/// What the Android app says back ({type: "lock", ok, enabled, message}).
fn listen_native() {
    let rt = dioxus::core::Runtime::current();
    let f = Closure::<dyn Fn(web_sys::CustomEvent)>::new(move |e: web_sys::CustomEvent| {
        let d = e.detail();
        let get = |k: &str| js_sys::Reflect::get(&d, &k.into()).ok();
        if get("type").and_then(|v| v.as_string()).as_deref() != Some("lock") { return; }
        let ok = get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let on = get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let msg = get("message").and_then(|v| v.as_string()).unwrap_or_default();
        rt.in_scope(ScopeId::ROOT, || {
            bump();
            if ok { toast(if on { "Fingerprint lock is on" } else { "Fingerprint lock is off" }, ""); } else { toast(if msg.is_empty() { "Not changed".to_string() } else { msg }, "warn"); }
        });
    });
    if let Some(w) = web_sys::window() { let _ = w.add_event_listener_with_callback("native", f.as_ref().unchecked_ref()); }
    f.forget();
}

/// Four dots and a keypad (the keyboard's digits and Backspace work too). on_code runs at the fourth digit and
/// returns a line to show when the code is wrong.
#[component]
pub fn PinPad(on_code: Callback<String, String>, #[props(default)] hint: String, #[props(default)] off: bool) -> Element {
    let mut code = use_signal(String::new);
    let mut msg = use_signal(String::new);
    let mut shake = use_signal(|| 0u32);
    let mut press = move |k: &str| {
        if off { return; }
        if k == "del" { if !code().is_empty() { crate::haptics::haptic("tick"); } code.write().pop(); return; }
        if code().len() >= 4 { return; }
        crate::haptics::haptic("tap");
        let next = format!("{}{}", code(), k);
        code.set(next.clone()); msg.set(String::new());
        if next.len() < 4 { return; }
        let wrong = on_code.call(next);
        if !wrong.is_empty() {
            crate::haptics::haptic("error");
            msg.set(wrong); shake.set(shake() + 1);
            spawn(async move { gloo_timers::future::TimeoutFuture::new(260).await; code.set(String::new()); });
        } else { crate::haptics::haptic("confirm"); code.set(String::new()); }
    };
    let rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "del"]];
    let n = code().len();
    rsx! {
        div { class: "pinpad", tabindex: "0", autofocus: true,
            onkeydown: move |e| { let k = e.key().to_string(); if k.len() == 1 && k.chars().all(|c| c.is_ascii_digit()) { press(&k); } else if e.key() == Key::Backspace { press("del"); } },
            div { key: "{shake}", class: if shake() > 0 { "pin-dots shake" } else { "pin-dots" }, aria_label: "{n} of 4 digits entered",
                for i in 0..4 { i { key: "{i}", class: if i < n { "on" } else { "" } } }
            }
            p { class: if msg().is_empty() { "pin-msg" } else { "pin-msg t-alert" }, role: "status", if msg().is_empty() { "{hint}" } else { "{msg}" } }
            if !off {
                div { class: "pin-keys",
                    for row in rows {
                        for k in row {
                            if k.is_empty() { span { key: "e{k}{row[0]}" } }
                            else if k == "del" { button { key: "{k}", class: "pin-k del", aria_label: "Delete", onclick: move |_| press("del"), Icon { name: "back".to_string(), size: 22.0 } } }
                            else { button { key: "{k}", class: "pin-k", onclick: move |_| press(k), "{k}" } }
                        }
                    }
                }
            }
        }
    }
}

/// Locked: the code before anything shows.
#[component]
pub fn PinLock() -> Element {
    let mut off = use_signal(|| false);
    let check = Callback::new(move |code: String| match check_pin(&code) {
        Check::Ok => { *LOCKED.write() = false; String::new() }
        Check::Off => { off.set(true); dioxus::core::spawn_forever(async { gloo_timers::future::TimeoutFuture::new(2600).await; *LOCKED.write() = false; sign_out(); });
            "Too many wrong codes, so the code is now off on this device. Signing you out…".to_string() }
        Check::Left(n) => format!("Wrong code. {} {} left.", n, if n == 1 { "try" } else { "tries" }),
    });
    rsx! {
        div { class: "signin",
            div { class: "si-card",
                h1 { class: "si-t", style: "text-align:center", "Money is locked" }
                PinPad { on_code: check, hint: "Enter your code.", off: off() }
                div { style: "text-align:center;margin-top:10px", button { class: "btn b-link", onclick: move |_| { clear_pin(); *LOCKED.write() = false; sign_out(); }, "Sign in another way" } }
            }
        }
    }
}

/// Settings → App lock code: set it, change it or turn it off.
#[component]
pub fn PinSheet() -> Element {
    let had = use_hook(has_pin);
    let mut step = use_signal(move || if had { "cur" } else { "new" });
    let mut first = use_signal(String::new);
    let done = move |m: &str| { toast(m, ""); *SHEET.write() = None; };
    let on_code = Callback::new(move |code: String| {
        match step() {
            "cur" => match check_pin(&code) {
                Check::Ok => { step.set("new"); String::new() }
                Check::Off => { dioxus::core::spawn_forever(async { gloo_timers::future::TimeoutFuture::new(2600).await; sign_out(); }); "Too many wrong codes, so the code is now off on this device. Signing you out…".into() }
                Check::Left(n) => format!("Wrong code. {} {} left.", n, if n == 1 { "try" } else { "tries" }),
            },
            "new" => { if obvious(&code) { return "Too easy to guess. Try another.".into(); } first.set(code); step.set("again"); String::new() }
            _ => {
                if code != first() { step.set("new"); return "Those didn't match. Choose a code.".into(); }
                set_pin(&code);
                done(if had { "Your code is changed" } else { "App lock code is on" });
                String::new()
            }
        }
    });
    let hint = match step() { "cur" => "Enter your current code.", "new" => if had { "Choose a new 4-digit code." } else { "Choose a 4-digit code." }, _ => "Enter it again." };
    rsx! {
        h2 { class: "sheet-t", "App lock code" }
        Note { "A quick unlock for this browser, like a phone PIN. Money asks for it when you come back after being away. It is kept only on this device; five wrong tries turn it off and sign you out." }
        PinPad { key: "{step}", on_code, hint }
        if had && step() != "cur" { div { style: "text-align:center;margin-top:12px", button { class: "btn b-ghost danger", onclick: move |_| { clear_pin(); done("App lock code is off"); }, "Turn the code off" } } }
    }
}
