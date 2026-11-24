//! Haptics: a short, matched buzz for each kind of thing that happens, never a buzz for its own sake.
//!
//! In the Android app the phone's own haptics play (window.AndroidBridge.haptic, the system's feedback kinds, so they
//! follow the phone's "touch feedback" setting); in a phone's browser, navigator.vibrate with a pulse sized to the
//! kind; on a laptop, nothing. Settings → Vibration turns them all off.
//!
//! The kinds, weakest first:
//!   fine     a slider passing a notch
//!   tick     a choice changed: a tab, chip, segment, day, month
//!   tap      a key on the PIN pad
//!   off/on   a switch
//!   drop     a drag let go
//!   grab     a drag taking hold (a slider)
//!   edge     a slider meeting its end or a mark (your plan's figure)
//!   confirm  something saved or done
//!   error    something refused, a wrong PIN, money going below zero
//!
//! Two rules keep it calm: a stronger kind wins over a weaker one fired at almost the same moment (a chip that saves
//! gives one "confirm", not a tick and a confirm), and slider notches are spaced so a fast drag never becomes a hum.

use std::cell::Cell;
use wasm_bindgen::{JsCast, JsValue};

const KEY: &str = "money-rs-haptics";

thread_local! {
    static LAST: Cell<(f64, u8)> = const { Cell::new((0.0, 0)) };
    static ON: Cell<Option<bool>> = const { Cell::new(None) };
}

fn strength(kind: &str) -> u8 {
    match kind { "fine" => 1, "tick" => 2, "tap" => 3, "off" | "on" | "drop" => 4, "grab" => 5, "edge" => 6, "confirm" => 7, "error" | "warn" | "heavy" => 8, _ => 2 }
}

/// Whether haptics are on (Settings → Vibration; on unless turned off).
pub fn enabled() -> bool {
    ON.with(|o| {
        if let Some(v) = o.get() { return v; }
        let v = crate::state::ls_get(KEY).map(|s| s != "0").unwrap_or(true);
        o.set(Some(v));
        v
    })
}
pub fn set_enabled(on: bool) {
    ON.with(|o| o.set(Some(on)));
    if on { crate::state::ls_del(KEY) } else { crate::state::ls_set(KEY, "0") }
    if on { play("on") }
}

/// Whether this device can buzz at all (the Android app, or a browser with vibration): Settings shows the switch only then.
pub fn available() -> bool { crate::lock::in_app() || vibrate_fn().is_some() }

/// Buzz for this kind of moment (see the list above).
pub fn haptic(kind: &'static str) {
    if !enabled() { return; }
    let doc_hidden = web_sys::window().and_then(|w| w.document()).map(|d| d.hidden()).unwrap_or(false);
    if doc_hidden { return; }
    let now = js_sys::Date::now();
    let s = strength(kind);
    let (t0, s0) = LAST.with(|l| l.get());
    let dt = now - t0;
    // a weaker buzz right after a stronger one would only blur it; the same kind twice inside 24 ms is one buzz
    if dt < 90.0 && s < s0 { return; }
    if dt < 24.0 && s <= s0 { return; }
    LAST.with(|l| l.set((now, s)));
    play(kind);
}

fn play(kind: &str) {
    if crate::lock::in_app() { let _ = crate::lock::call("haptic", &[JsValue::from_str(kind)]); return; }
    let Some((nav, f)) = vibrate_fn() else { return };
    let pattern: JsValue = match kind {
        "fine" => 4.into(), "tick" => 7.into(), "tap" => 9.into(), "off" => 6.into(), "on" => 11.into(), "drop" => 6.into(), "grab" => 12.into(),
        "edge" => 16.into(), "heavy" => 24.into(),
        "confirm" => js_sys::Array::of3(&10.into(), &50.into(), &14.into()).into(),
        "error" | "warn" => js_sys::Array::of5(&16.into(), &60.into(), &16.into(), &60.into(), &16.into()).into(),
        _ => 7.into(),
    };
    let _ = f.call1(&nav, &pattern);
}

fn vibrate_fn() -> Option<(JsValue, js_sys::Function)> {
    let w = web_sys::window()?;
    let nav = js_sys::Reflect::get(&w, &"navigator".into()).ok()?;
    let f = js_sys::Reflect::get(&nav, &"vibrate".into()).ok()?.dyn_into::<js_sys::Function>().ok()?;
    Some((nav, f))
}

/// Notches for a slider running 0..max: a round rupee step giving about twenty across, so the buzz under your thumb
/// means a round figure (₹1,000, ₹5,000 …) rather than an arbitrary fraction.
pub fn notch(max: f64) -> f64 {
    let raw = (max / 20.0).max(1.0);
    for s in [100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0, 5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0] { if s >= raw { return s; } }
    100000.0
}
