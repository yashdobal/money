//! What the screens read and how it changes: the engine (money-core) with your data in it, your sign-in, the line
//! under the title ("Emails checked just now"), and which tab and sheet are open. Screens read figures from the
//! engine through `eng()` and redraw when `VER` changes.

use crate::api::{self, Session};
use dioxus::prelude::*;
use money_core::{shape, Engine};
use std::cell::RefCell;

thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::new()); }

/// Read the engine (one borrow; don't call `eng` inside the closure).
pub fn eng<R>(f: impl FnOnce(&Engine) -> R) -> R { ENGINE.with(|e| f(&e.borrow())) }
pub fn eng_mut<R>(f: impl FnOnce(&mut Engine) -> R) -> R { ENGINE.with(|e| f(&mut e.borrow_mut())) }

/// Bumped whenever your data or settings change: every screen redraws.
pub static VER: GlobalSignal<u64> = Signal::global(|| 0);
pub static SESSION: GlobalSignal<Option<Session>> = Signal::global(|| None);
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Phase { Starting, SignedOut, Loading, Ready }
thread_local! { static STEP: std::cell::RefCell<String> = std::cell::RefCell::new(String::new()); }
/// What the app is doing right now (shown if something goes wrong).
pub fn step(s: &str) { STEP.with(|x| *x.borrow_mut() = s.to_string()); }
pub fn current_step() -> String { STEP.with(|x| x.borrow().clone()) }
pub static PHASE: GlobalSignal<Phase> = Signal::global(|| Phase::Starting);
#[derive(Clone, PartialEq, Debug)]
pub struct Feed { pub tone: &'static str, pub text: String }
pub static FEED: GlobalSignal<Feed> = Signal::global(|| Feed { tone: "idle", text: "Starting up".into() });
pub static BUSY: GlobalSignal<bool> = Signal::global(|| false);
/// Amounts hidden (the eye button).
pub static HIDDEN: GlobalSignal<bool> = Signal::global(|| false);
pub static SHEET: GlobalSignal<Option<String>> = Signal::global(|| None);
pub static TAB: GlobalSignal<usize> = Signal::global(|| 0);
/// Made-up data (?demo), for trying the app and for the checks.
pub static DEMO: GlobalSignal<bool> = Signal::global(|| false);

pub fn bump() { *VER.write() += 1; }

/// A message along the bottom for a moment ("Saved", "Couldn't save that"). tone: "" or "alert"/"warn".
#[derive(Clone, PartialEq, Debug)]
pub struct Toast { pub text: String, pub tone: &'static str, pub n: u64, pub undo: Option<String> }
pub static TOAST: GlobalSignal<Option<Toast>> = Signal::global(|| None);
pub fn toast(text: impl Into<String>, tone: &'static str) { toast_undo(text, tone, None); }
/// A toast with an Undo button: `undo` is the id to unreverse (the only undo there is so far).
pub fn toast_undo(text: impl Into<String>, tone: &'static str, undo: Option<String>) {
    let n = TOAST.read().as_ref().map(|t| t.n + 1).unwrap_or(1);
    *TOAST.write() = Some(Toast { text: text.into(), tone, n, undo: undo.clone() });
    spawn(async move {
        gloo_timers::future::TimeoutFuture::new(if undo.is_some() { 5000 } else { 2600 }).await;
        if TOAST.read().as_ref().map(|t| t.n) == Some(n) { *TOAST.write() = None; }
    });
}

/// What Activity is showing: the filter chip, the search, and filters other screens open it with.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct ActParams { pub f: String, pub q: String, pub cat: String, pub card: String, pub acct: String, pub m: String, pub d: String, pub seq: u64 }
pub static ACT: GlobalSignal<ActParams> = Signal::global(ActParams::default);
/// Open Activity with these filters (from Spending, Cards …).
pub fn show_activity(p: ActParams) { let seq = ACT.read().seq + 1; *ACT.write() = ActParams { seq, ..p }; *SHEET.write() = None; *TAB.write() = 4; }

/* ---------------- changes and saving ---------------- */
/// Make a change (an engine action), redraw, send any note or rule writes, and save the settings a moment later.
pub fn act<R>(f: impl FnOnce(&mut Engine) -> R) -> R {
    let r = eng_mut(f);
    bump();
    let writes = eng_mut(|e| std::mem::take(&mut e.outbox));
    if !writes.is_empty() && !*DEMO.read() { spawn(async move { send_writes(writes).await; }); }
    if eng(|e| e.unsaved) { queue_save(); }
    r
}
static SAVE_GEN: GlobalSignal<u64> = Signal::global(|| 0);
pub static SAVE_MSG: GlobalSignal<String> = Signal::global(String::new);
fn queue_save() {
    let g = *SAVE_GEN.read() + 1;
    *SAVE_GEN.write() = g;
    *SAVE_MSG.write() = "Saving…".into();
    spawn(async move {
        gloo_timers::future::TimeoutFuture::new(700).await;
        if *SAVE_GEN.read() == g { save().await; }
    });
}
/// Saves your settings (the app function's "save"), as the current app does: with the version it loaded, so a change
/// made meanwhile on another device isn't overwritten (that reloads instead).
async fn save() {
    if *DEMO.read() { eng_mut(|e| e.unsaved = false); *SAVE_MSG.write() = "The demo doesn't save".into(); return; }
    let Some(s) = fresh().await else { return };
    let (blob, base) = eng(|e| (e.save_blob(), e.app_version));
    match api::call_app(&s, serde_json::json!({ "action": "save", "settings": blob, "baseVersion": base })).await {
        Ok((200, out)) => {
            let v = out.get("version").and_then(|v| v.as_i64()).unwrap_or(base);
            eng_mut(|e| { e.app_version = v; e.unsaved = false; });
            *SAVE_MSG.write() = "Saved.".into();
        }
        Ok((409, _)) => {
            *SAVE_MSG.write() = "Changed on another device, so this shows the latest.".into();
            toast("Changed on another device, so this shows the latest.", "warn");
            load().await;
        }
        Ok((st, out)) => {
            let m = out.get("error").and_then(|x| x.as_str()).map(String::from).unwrap_or_else(|| format!("Save failed ({})", st));
            *SAVE_MSG.write() = m.clone();
            toast(format!("Couldn't save that: {}", m), "alert");
        }
        Err(e) => { *SAVE_MSG.write() = e.clone(); toast("You're offline, so that isn't saved yet. Try again when you're back online.", "warn"); }
    }
}
async fn send_writes(writes: Vec<money_core::engine::Write>) {
    let Some(s) = fresh().await else { return };
    for w in writes {
        if let Err(e) = api::write(&s, &w).await { toast(format!("Couldn't save that: {}", e), "alert"); }
    }
}

fn storage() -> Option<web_sys::Storage> { web_sys::window().and_then(|w| w.local_storage().ok().flatten()) }
pub fn ls_get(k: &str) -> Option<String> { storage().and_then(|s| s.get_item(k).ok().flatten()) }
pub fn ls_set(k: &str, v: &str) { if let Some(s) = storage() { let _ = s.set_item(k, v); } }
pub fn ls_del(k: &str) { if let Some(s) = storage() { let _ = s.remove_item(k); } }
const SESSION_KEY: &str = "money-rs-session";

fn query() -> String { web_sys::window().and_then(|w| w.location().search().ok()).unwrap_or_default() }
fn param(name: &str) -> Option<String> {
    let q = query();
    q.trim_start_matches('?').split('&').find_map(|kv| { let mut it = kv.splitn(2, '='); if it.next() == Some(name) { Some(it.next().unwrap_or("").to_string()) } else { None } })
}

/// At start: the demo, your saved sign-in, or the sign-in screen.
pub fn start() {
    if let Some(h) = ls_get("money-rs-hidden") { *HIDDEN.write() = h == "1"; }
    if param("demo").is_some() {
        *DEMO.write() = true;
        let at = param("at").and_then(|d| money_core::time::parse_iso_at(&d, 10));
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../tools/demo/demo-fixture.json")).unwrap();
        let data = shape::shape_data(&shape::rows_from_fixture(&fixture));
        eng_mut(|e| { *e = Engine::new(); e.clock = at; e.ingest(&data); });
        *FEED.write() = Feed { tone: "ok", text: "Made-up data · the demo".into() };
        *PHASE.write() = Phase::Ready;
        bump();
        return;
    }
    match ls_get(SESSION_KEY).and_then(|s| serde_json::from_str::<Session>(&s).ok()) {
        Some(s) => { *SESSION.write() = Some(s); *PHASE.write() = Phase::Loading; spawn(async { load().await; }); }
        None => *PHASE.write() = Phase::SignedOut,
    }
}

pub fn signed_in(s: Session) {
    ls_set(SESSION_KEY, &serde_json::to_string(&s).unwrap_or_default());
    ls_set("money-rs-email", &s.email);
    *SESSION.write() = Some(s);
    *PHASE.write() = Phase::Loading;
    spawn(async { load().await; });
}
pub fn sign_out() {
    ls_del(SESSION_KEY);
    *SESSION.write() = None;
    eng_mut(|e| *e = Engine::new());
    *PHASE.write() = Phase::SignedOut;
    bump();
}

/// Your sign-in, refreshed if it runs out within a minute.
pub async fn fresh() -> Option<Session> {
    let s = SESSION.read().clone()?;
    let now = (js_sys::Date::now() / 1000.0) as i64;
    if s.expires_at - now > 60 { return Some(s); }
    match api::refresh(&s).await {
        Ok(n) => { ls_set(SESSION_KEY, &serde_json::to_string(&n).unwrap_or_default()); *SESSION.write() = Some(n.clone()); Some(n) }
        Err(_) => { sign_out(); None }
    }
}

/// Load the latest from your account into the engine.
pub async fn load() {
    if *DEMO.read() { return; }
    let Some(s) = fresh().await else { return };
    *BUSY.write() = true;
    let had = eng(|e| !e.tx.is_empty());
    *FEED.write() = Feed { tone: "warn", text: if had { "Checking for new emails…".into() } else { "Loading…".into() } };
    step("reading your account");
    match api::load(&s).await {
        Ok(rows) => {
            step("sorting your transactions");
            let data = shape::shape_data(&rows);
            step("working out your figures");
            let view = eng(|e| e.plan_view.clone());
            eng_mut(|e| { *e = Engine::new(); e.plan_view = view; e.ingest(&data); });
            let (n, ago) = eng(|e| (e.tx.len(), e.last_run.map(|t| e.ago(t)).unwrap_or_else(|| "never".into())));
            *FEED.write() = Feed { tone: "ok", text: if n > 0 { format!("Emails checked {}", ago) } else { "Connected. No transactions yet.".into() } };
            step("drawing the screen");
            *PHASE.write() = Phase::Ready;
        }
        Err(e) => {
            *FEED.write() = Feed { tone: "warn", text: format!("Couldn't load: {}", e) };
            if *PHASE.read() == Phase::Loading { *PHASE.write() = Phase::Ready; }
        }
    }
    *BUSY.write() = false;
    bump();
}

/// Refresh: ask the collector to read Gmail now, wait for it (up to about 2½ minutes), then load what it found.
pub async fn refresh() {
    if *BUSY.read() { return; }
    if *DEMO.read() { *FEED.write() = Feed { tone: "ok", text: "The demo doesn't check email".into() }; return; }
    let Some(s) = fresh().await else { return };
    *BUSY.write() = true;
    *FEED.write() = Feed { tone: "warn", text: "Asking the collector to check Gmail…".into() };
    let before = api::last_sync(&s).await.unwrap_or(0);
    if let Ok((200, _)) = api::call_app(&s, serde_json::json!({ "action": "refresh" })).await {
        for i in 0..38 {
            gloo_timers::future::TimeoutFuture::new(4000).await;
            *FEED.write() = Feed { tone: "warn", text: format!("Checking Gmail… ({} s)", (i + 1) * 4) };
            if api::last_sync(&s).await.unwrap_or(0) > before { break; }
        }
    }
    *BUSY.write() = false;
    load().await;
}

pub fn set_hidden(h: bool) { *HIDDEN.write() = h; ls_set("money-rs-hidden", if h { "1" } else { "0" }); }
