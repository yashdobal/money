//! Money in Rust: the screens (Dioxus, as WebAssembly in the browser), on the engine in money-core.

mod api;
mod kit;
mod settings;
mod sheets;
mod shell;
mod state;
mod today;

use dioxus::prelude::*;
use state::{Phase, PHASE};

fn main() { dioxus::launch(App); }

#[component]
fn App() -> Element {
    use_hook(state::start);
    match PHASE() {
        Phase::Starting | Phase::Loading => rsx! { div { class: "boot", div { class: "boot-dot" } p { "Loading your figures…" } } },
        Phase::SignedOut => rsx! { shell::SignIn {} },
        Phase::Ready => rsx! { shell::Shell {} },
    }
}
