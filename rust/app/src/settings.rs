//! Settings (for now: your account, the demo, and where this app stands).

use crate::kit::*;
use crate::state::*;
use dioxus::prelude::*;

#[component]
pub fn Settings() -> Element {
    let _ = VER();
    let s = SESSION();
    let demo = DEMO();
    let n = eng(|e| e.tx.len());
    rsx! {
        div { class: "page",
            Panel { title: "Account", kind: "w",
                if demo { Note { "You're looking at made-up data (the demo)." } }
                else if let Some(s) = s { Note { "Signed in as {s.email}" } Btn { label: "Sign out", kind: "ghost", small: true, onclick: move |_| sign_out() } }
            }
            Panel { title: "The Rust app", kind: "w",
                Note { "This is Money rebuilt in Rust, next to your current app. Its figures come from the same engine, checked against the current one on every change. Today is done; the other screens are coming one by one." }
                Note { {format!("{} transactions loaded · engine {}", n, money_core::version())} }
                a { class: "btn b-ghost small", href: "https://yash-money.pages.dev", "Open the current app" }
            }
        }
    }
}
