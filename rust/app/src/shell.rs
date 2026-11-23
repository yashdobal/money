//! The frame around the screens: the title and the line under it ("Emails checked just now"), the eye / refresh /
//! settings buttons, the bottom bar with its sliding pill, the sideways page push, and sheets (rn/src/App.js).

use crate::kit::*;
use crate::sheets::SheetBody;
use crate::state::*;
use crate::today::Today;
use dioxus::prelude::*;

pub const TABS: [(&str, &str); 7] = [("Today", "today"), ("Plan", "plan"), ("Cards", "cards"), ("Spending", "spend"), ("Activity", "activity"), ("Trips", "trips"), ("Rewards", "rewards")];

#[component]
pub fn Shell() -> Element {
    let tab = TAB();
    let mut prev = use_signal(|| 0usize);
    let mut shown_tab = use_signal(|| 0usize);
    // which way the page and the pill move: towards the tab you picked
    let dir = if tab >= prev() { "r" } else { "l" };
    use_effect(move || { let t = TAB(); if t != shown_tab() { prev.set(shown_tab()); shown_tab.set(t); } });
    let title = if tab == 7 { "Settings" } else { TABS[tab].0 };
    let feed = FEED();
    let busy = BUSY();
    let hidden = HIDDEN();
    rsx! {
        div { class: "app",
            header { class: "top",
                div { class: "top-l",
                    h1 { key: "{tab}", class: "title push-{dir}", "{title}" }
                    div { class: "feed f-{feed.tone}", i {} span { "{feed.text}" } }
                }
                div { class: "top-r",
                    button { class: "round", aria_label: if hidden { "Show amounts" } else { "Hide amounts" }, onclick: move |_| set_hidden(!hidden),
                        Icon { name: if hidden { "eyeOff".to_string() } else { "eye".to_string() }, size: 22.0 } }
                    button { class: if busy { "round spin" } else { "round" }, aria_label: "Refresh", onclick: move |_| { spawn(async { refresh().await; }); },
                        Icon { name: "refresh".to_string(), size: 22.0 } }
                    button { class: "round", aria_label: "Settings", onclick: move |_| *TAB.write() = 7, Icon { name: "settings".to_string(), size: 22.0 } }
                }
            }
            main { key: "{tab}", class: "screen push-{dir}",
                match tab { 0 => rsx! { Today {} }, 4 => rsx! { crate::activity::Activity {} }, 7 => rsx! { crate::settings::Settings {} }, t => rsx! { Soon { name: TABS[t].0.to_string() } } }
            }
            if tab == 4 { crate::activity::Fab {} }
            Dock { tab, from: prev() }
            SheetHost {}
            ToastHost {}
        }
    }
}

/// A screen not rebuilt in Rust yet.
#[component]
fn Soon(name: String) -> Element {
    rsx! { div { class: "page", Panel { title: name.clone(), kind: "w", Note { "{name} is next on the list for the Rust app. Until then, your current app has it." } } } }
}

/// The bottom bar: a capsule with a pill behind the chosen tab. The pill's leading edge springs ahead and its trailing
/// edge follows, so it stretches as it travels (App.js Dock).
#[component]
fn Dock(tab: usize, from: usize) -> Element {
    let n = TABS.len() as f64;
    let at = if tab < TABS.len() { tab } else { from.min(TABS.len() - 1) };
    let right_moves = at >= from;
    let (l, r) = (at as f64 / n * 100.0, (n - at as f64 - 1.0) / n * 100.0);
    // the edge in front moves fast, the one behind slowly
    let style = format!("left:calc({l}% + 4px);right:calc({r}% + 4px);transition:left {}ms cubic-bezier(.3,1.3,.5,1),right {}ms cubic-bezier(.3,1.3,.5,1);",
        if right_moves { 420 } else { 240 }, if right_moves { 240 } else { 420 });
    rsx! {
        nav { class: "dock",
            div { class: if tab < TABS.len() { "pill" } else { "pill gone" }, style: "{style}" }
            for (i, (name, icon)) in TABS.iter().enumerate() {
                button { key: "{i}", class: if i == tab { "tab on" } else { "tab" }, aria_label: "{name}", onclick: move |_| *TAB.write() = i,
                    Icon { name: icon.to_string(), size: 23.0 } span { "{name}" }
                }
            }
        }
    }
}

/// A sheet over the screen: slides up, closes on the backdrop or ✕.
#[component]
fn SheetHost() -> Element {
    let Some(name) = SHEET() else { return rsx! {} };
    let close = move |_| *SHEET.write() = None;
    rsx! {
        div { class: "sheet-wrap",
            div { class: "backdrop", onclick: close }
            div { class: "sheet", role: "dialog",
                div { class: "grab" }
                button { class: "round sheet-x", aria_label: "Close", onclick: close, Icon { name: "close".to_string(), size: 20.0 } }
                SheetBody { name: name.clone() }
            }
        }
    }
}

/// Sign in with a code sent to your email (the same accounts as the current app).
#[component]
pub fn SignIn() -> Element {
    let mut email = use_signal(|| ls_get("money-rs-email").unwrap_or_default());
    let mut code = use_signal(String::new);
    let mut sent = use_signal(|| false);
    let mut msg = use_signal(String::new);
    let mut working = use_signal(|| false);
    let send = move |_| {
        let e = email().trim().to_lowercase();
        if !e.contains('@') { msg.set("Type the email you use for Money.".into()); return; }
        working.set(true); msg.set(String::new());
        spawn(async move {
            match crate::api::send_code(&e).await { Ok(()) => { sent.set(true); msg.set(format!("We sent a 6-digit code to {}.", e)); } Err(x) => msg.set(x) }
            working.set(false);
        });
    };
    let check = move |_| {
        let (e, c) = (email().trim().to_lowercase(), code().trim().to_string());
        if c.len() < 6 { msg.set("The code has 6 digits.".into()); return; }
        working.set(true); msg.set(String::new());
        spawn(async move {
            match crate::api::verify(&e, &c).await { Ok(s) => signed_in(s), Err(x) => msg.set(x) }
            working.set(false);
        });
    };
    rsx! {
        div { class: "signin",
            div { class: "si-card",
                h1 { "Money" }
                p { class: "si-sub", "The Rust app · sign in with the email you use for Money" }
                if !sent() {
                    input { class: "field", r#type: "email", placeholder: "you@example.com", autocomplete: "email", value: "{email}", oninput: move |e| email.set(e.value()) }
                    button { class: "btn b-solid big", disabled: working(), onclick: send, if working() { "Sending…" } else { "Email me a code" } }
                } else {
                    input { class: "field code", inputmode: "numeric", autocomplete: "one-time-code", placeholder: "6-digit code", maxlength: "8", value: "{code}", oninput: move |e| code.set(e.value()) }
                    button { class: "btn b-solid big", disabled: working(), onclick: check, if working() { "Checking…" } else { "Sign in" } }
                    button { class: "btn b-link", onclick: move |_| { sent.set(false); code.set(String::new()); }, "Use a different email" }
                }
                if !msg().is_empty() { p { class: "si-msg", "{msg}" } }
                p { class: "si-foot", "Your current app keeps working as it is. This one reads the same account." }
            }
        }
    }
}
