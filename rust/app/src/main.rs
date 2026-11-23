//! Money in Rust: the screens (Dioxus, as WebAssembly in the browser), on the engine in money-core.

mod activity;
mod api;
mod cards;
mod kit;
mod lock;
mod plan;
mod rewards;
mod settings;
mod sheets;
mod shell;
mod spend;
mod state;
mod today;
mod trips;
mod txsheets;

use dioxus::prelude::*;
use state::{Phase, PHASE};

fn main() { dioxus::launch(App); }

#[component]
fn App() -> Element {
    use_hook(state::start);
    use_hook(back_button);
    use_hook(lock::start);
    if lock::LOCKED() { return rsx! { lock::PinLock {} }; }
    match PHASE() {
        Phase::Starting | Phase::Loading => rsx! { div { class: "boot", div { class: "boot-dot" } p { "Loading your figures…" } } },
        Phase::SignedOut => rsx! { shell::SignIn {} },
        Phase::Ready => rsx! { shell::Shell {} },
    }
}

/// The phone's back button (the Android app asks window.UI.back()): close a sheet, else go back to Today; false lets
/// the app go to the background.
fn back_button() {
    use wasm_bindgen::prelude::*;
    let rt = dioxus::core::Runtime::current();
    let f = Closure::<dyn Fn() -> bool>::new(move || {
        rt.in_scope(ScopeId::ROOT, || {
            if state::SHEET.peek().is_some() { *state::SHEET.write() = None; return true; }
            if *state::TAB.peek() != 0 { *state::TAB.write() = 0; return true; }
            false
        })
    });
    if let Some(w) = web_sys::window() {
        let ui = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&ui, &"back".into(), f.as_ref());
        let _ = js_sys::Reflect::set(&w, &"UI".into(), &ui);
    }
    f.forget();
}
