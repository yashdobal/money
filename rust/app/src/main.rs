use dioxus::prelude::*;

fn main() { dioxus::launch(App); }

#[component]
fn App() -> Element {
    rsx! { div { class: "boot", h1 { "Money" } p { "The Rust app is starting · engine " {money_core::version()} } } }
}
