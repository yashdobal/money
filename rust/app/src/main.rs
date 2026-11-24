//! Money in Rust: the screens (Dioxus, as WebAssembly in the browser), on the engine in money-core.

mod activity;
mod api;
mod cards;
mod haptics;
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

fn main() {
    install_panic_hook();
    dioxus::launch(App);
}

/// If anything crashes, say so on the screen (what and where) instead of freezing on the loading screen.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("{}\n\nWhile: {}", info, state::current_step());
        web_sys::console::error_1(&msg.clone().into());
        if let Some(d) = web_sys::window().and_then(|w| w.document()) {
            if d.get_element_by_id("crash").is_some() { return; }
            if let (Ok(el), Some(body)) = (d.create_element("div"), d.body()) {
                let esc = msg.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                el.set_id("crash");
                el.set_inner_html(&format!("<div class=\"crash\"><b>Something broke</b><p>Please send a screenshot of this to Claude.</p><pre>{}</pre><button onclick=\"location.reload()\">Reload</button></div>", esc));
                let _ = body.append_child(&el);
            }
        }
    }));
}

#[component]
fn App() -> Element {
    use_hook(state::start);
    use_hook(back_button);
    use_hook(lock::start);
    if lock::LOCKED() { return rsx! { lock::PinLock {} }; }
    let mut slow = use_signal(|| false);
    use_future(move || async move { gloo_timers::future::TimeoutFuture::new(12_000).await; slow.set(true); });
    match PHASE() {
        Phase::Starting | Phase::Loading => rsx! { div { class: "boot", div { class: "boot-dot" } p { "Loading your figures…" }
            if slow() { div { class: "boot-slow",
                p { "This is taking longer than it should. Stuck on: " b { "{state::current_step()}" } }
                button { class: "btn", onclick: move |_| { dioxus::core::spawn_forever(async { state::load().await; }); }, "Try again" }
                button { class: "btn", onclick: move |_| state::sign_out(), "Sign out" }
            } }
        } },
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
