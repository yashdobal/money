//! The frame around the screens: the title and the line under it ("Emails checked just now"), the eye / refresh /
//! settings buttons, the bottom bar with its sliding pill, the sideways page push, and sheets.

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
    // the "… min ago" under the title stays true as time passes
    let mut tick = use_signal(|| 0u32);
    use_future(move || async move { loop { gloo_timers::future::TimeoutFuture::new(30_000).await; tick += 1; } });
    let _ = tick();
    let mut feed = FEED();
    if feed.tone == "ok" && !*DEMO.read() { if let Some(t) = CHECKED_AT() { feed.text = format!("Emails checked {}", eng(|e| e.ago(t))); } }
    // a screen's blocks rise in on its first visit only; coming back, it's simply there
    let seen = VISITED.read().contains(&tab);
    use_effect(move || { let t = TAB(); if !VISITED.peek().contains(&t) { VISITED.write().insert(t); } });
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
                    button { class: "round", aria_label: if hidden { "Show amounts" } else { "Hide amounts" }, onclick: move |_| { haptic("tick"); set_hidden(!hidden) },
                        Icon { name: if hidden { "eyeOff".to_string() } else { "eye".to_string() }, size: 22.0 } }
                    button { class: if busy { "round spin" } else { "round" }, aria_label: "Refresh", onclick: move |_| { if !busy { haptic("tap"); } dioxus::core::spawn_forever(async { refresh().await; }); },
                        Icon { name: "refresh".to_string(), size: 22.0 } }
                    button { class: if tab == 7 { "round set-btn on" } else { "round set-btn" }, aria_label: "Settings", onclick: move |_| go_tab(7), Icon { name: "settings".to_string(), size: 22.0 } }
                }
            }
            main { key: "{tab}", class: if seen { "screen push-{dir} seen" } else { "screen push-{dir}" },
                match tab { 0 => rsx! { Today {} }, 1 => rsx! { crate::plan::Plan {} }, 2 => rsx! { crate::cards::Cards {} }, 3 => rsx! { crate::spend::Spend {} }, 4 => rsx! { crate::activity::Activity {} }, 5 => rsx! { crate::trips::Trips {} }, 6 => rsx! { crate::rewards::Rewards {} }, 7 => rsx! { crate::settings::Settings {} }, t => rsx! { Soon { name: TABS[t].0.to_string() } } }
            }
            if tab == 4 { crate::activity::Fab {} }
            Dock { tab, from: prev() }
            SheetHost {}
            ToastHost {}
        }
    }
}

/// A tab that doesn't exist (never reached: every tab has its screen).
#[component]
fn Soon(name: String) -> Element {
    rsx! { div { class: "page", Panel { title: name.clone(), kind: "w", Note { "Nothing here." } } } }
}

/// The bottom bar: a capsule with a soft tile behind the chosen tab. The tile glides to the tab you pick, its leading
/// edge a touch ahead of the trailing one, so it moves calmly rather than snapping.
#[component]
fn Dock(tab: usize, from: usize) -> Element {
    let n = TABS.len() as f64;
    let at = if tab < TABS.len() { tab } else { from.min(TABS.len() - 1) };
    let right_moves = at >= from;
    let (l, r) = (at as f64 / n * 100.0, (n - at as f64 - 1.0) / n * 100.0);
    // the edge in front moves fast, the one behind slowly
    let style = format!("left:calc({l}% + 5px);right:calc({r}% + 5px);transition:left {}ms cubic-bezier(.25,.8,.3,1),right {}ms cubic-bezier(.25,.8,.3,1),opacity 200ms ease;",
        if right_moves { 380 } else { 300 }, if right_moves { 300 } else { 380 });
    rsx! {
        nav { class: "dock",
            // on a laptop the bar is a sidebar: the app's name on top, the screens, and Settings at the foot
            div { class: "side-brand", i { "₹" } b { "Money" } }
            div { class: if tab < TABS.len() { "pill" } else { "pill gone" }, style: "{style}" }
            for (i, (name, icon)) in TABS.iter().enumerate() {
                button { key: "{i}", class: if i == tab { "tab on" } else { "tab" }, aria_label: "{name}", onclick: move |_| go_tab(i),
                    Icon { name: icon.to_string(), size: 23.0 } span { "{name}" }
                }
            }
            div { class: "side-gap" }
            button { class: if tab == 7 { "tab side-set on" } else { "tab side-set" }, aria_label: "Settings", onclick: move |_| go_tab(7),
                Icon { name: "settings".to_string(), size: 22.0 } span { "Settings" }
            }
        }
    }
}

/// The screens opened since the app started (their blocks don't rise in again).
static VISITED: GlobalSignal<std::collections::HashSet<usize>> = Signal::global(Default::default);

/// Go to a tab: a tick as it changes; tapping the tab you're on takes you back to its top instead.
fn go_tab(i: usize) {
    if *TAB.peek() == i {
        if let Some(w) = web_sys::window() { if w.scroll_y().unwrap_or(0.0) > 4.0 { haptic("tap"); let o = web_sys::ScrollToOptions::new(); o.set_top(0.0); o.set_behavior(web_sys::ScrollBehavior::Smooth); w.scroll_to_with_scroll_to_options(&o); } }
        return;
    }
    haptic("tick");
    *TAB.write() = i;
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

/// Sign in with a code sent to your email.
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
                p { class: "si-sub", "Sign in with the email you use for Money" }
                if !sent() {
                    input { class: "field", r#type: "email", placeholder: "you@example.com", autocomplete: "email", value: "{email}", oninput: move |e| email.set(e.value()) }
                    button { class: "btn b-solid big", disabled: working(), onclick: send, if working() { "Sending…" } else { "Email me a code" } }
                } else {
                    input { class: "field code", inputmode: "numeric", autocomplete: "one-time-code", placeholder: "6-digit code", maxlength: "8", value: "{code}", oninput: move |e| code.set(e.value()) }
                    button { class: "btn b-solid big", disabled: working(), onclick: check, if working() { "Checking…" } else { "Sign in" } }
                    button { class: "btn b-link", onclick: move |_| { sent.set(false); code.set(String::new()); }, "Use a different email" }
                }
                if !msg().is_empty() { p { class: "si-msg", "{msg}" } }
                p { class: "si-foot", "We email you a 6-digit code. No password to remember." }
            }
        }
    }
}
