//! Supabase rows → what the engine reads (app/shape.js). The same tables and columns the current app selects
//! (rn/src/store.js getData), so both apps read the same data.

use crate::refine::refine;
use crate::time::{self, Ms};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Tx {
    pub id: String,
    pub ts: Ms,
    pub day: i32,
    pub ym: String,
    pub account: String,
    pub kind: String,
    pub desc: String,
    pub cat: String,
    pub amt: f64,
    pub dir: String,
    pub counted: bool,
    #[serde(default)]
    pub raw: String,
    /// A refund you marked (Activity → reversed or refunded): the charge it's for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refund_of: Option<String>,
    /// From an SMS on the phone (the native app only).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sms: bool,
}
impl Tx {
    pub fn out(&self) -> bool { self.dir == "out" }
    pub fn signed(&self) -> f64 { if self.dir == "in" { self.amt } else { -self.amt } }
}

/// A card email: statement, payment received, due reminder.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    pub ts: Ms,
    pub last4: String,
    #[serde(rename = "type")]
    pub typ: String,
    pub amt: f64,
    pub min: Option<f64>,
    pub due: String,
    pub stmt: String,
    pub src: String,
    pub issuer: String,
}

/// Your note on a transaction (txn_notes).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub category: Option<String>,
    pub for_someone_else: bool,
    pub paid_back: bool,
    pub note: String,
}

#[derive(Clone, Debug, Default)]
pub struct Edits { pub ok: bool, pub rules: BTreeMap<String, String>, pub notes: BTreeMap<String, Note> }

#[derive(Clone, Debug, Default)]
pub struct Data {
    pub notes_ok: bool,
    pub notes: BTreeMap<String, Note>,
    pub payee_rules: BTreeMap<String, String>,
    pub last_run: Option<Ms>,
    pub tx: Vec<Tx>,
    pub events: Vec<Event>,
    pub app_version: i64,
    /// The app's saved settings (settings.app.state.data), as stored: read by Engine::apply_settings.
    pub settings: Map<String, Value>,
}

/// The tables as Supabase returns them for the app's selects.
#[derive(Clone, Debug, Default)]
pub struct Rows {
    pub tx: Vec<Value>,
    pub emails: Vec<Value>,
    pub pays: Vec<Value>,
    pub goals: Vec<Value>,
    pub contribs: Vec<Value>,
    pub rules: Vec<Value>,
    pub settings: Vec<Value>,
    pub last_sync: Option<String>,
    pub edits: Edits,
}

fn s(v: &Value, k: &str) -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() }
fn n(v: &Value, k: &str) -> Option<f64> { v.get(k).and_then(|x| x.as_f64()) }
fn live(list: &[Value]) -> impl Iterator<Item = &Value> { list.iter().filter(|r| r.get("deleted_at").map(|d| d.is_null()).unwrap_or(true)) }
fn rupees(v: &Value, k: &str) -> Value { match n(v, k) { Some(p) => Value::from(p / 100.0), None => Value::Null } }

pub fn shape_edits(rule_rows: &[Value], note_rows: &[Value]) -> Edits {
    let mut e = Edits { ok: true, ..Default::default() };
    for x in rule_rows { e.rules.insert(s(x, "pattern"), s(x, "category")); }
    for x in note_rows {
        let cat = x.get("category").and_then(|c| c.as_str()).filter(|c| !c.is_empty()).map(String::from);
        e.notes.insert(s(x, "txn_ref"), Note { category: cat, for_someone_else: x.get("for_someone_else").and_then(|b| b.as_bool()).unwrap_or(false),
            paid_back: x.get("paid_back").and_then(|b| b.as_bool()).unwrap_or(false), note: s(x, "note") });
    }
    e
}

pub fn shape_data(rows: &Rows) -> Data {
    let shaped: Vec<(Tx, bool)> = live(&rows.tx).map(|r| {
        let ts = time::parse_ts(&s(r, "occurred_at")).unwrap_or(0);
        let acc = r.get("accounts");
        let account = acc.and_then(|a| a.get("aliases")).and_then(|a| a.get(0)).and_then(|a| a.as_str()).unwrap_or("").to_string();
        let kind = acc.and_then(|a| a.get("kind")).and_then(|a| a.as_str()).unwrap_or("").to_string();
        let dir = s(r, "direction");
        let refd = refine(&kind, &s(r, "description"), r.get("snippet").and_then(|x| x.as_str()).unwrap_or(""), &dir);
        let auto = s(r, "description").trim_end().ends_with("(auto-debit)");
        (Tx { id: s(r, "source_ref"), ts, day: time::date(ts), ym: time::ym_of(ts), account, kind, desc: refd.description, cat: refd.category,
            amt: n(r, "amount").unwrap_or(0.0) / 100.0, dir, counted: refd.counted, raw: refd.raw, refund_of: None, sms: false }, auto)
    }).collect();
    // SBI Card sends two emails for one auto-debit: the "spent on your SBI Credit Card … at MERCHANT" alert and
    // "Recurring E-mandate processed successfully" (read as "MERCHANT (auto-debit)"). One payment, so the auto-debit
    // copy goes when an alert for the same card, amount and day is there (one to one; shape.js).
    let mut used: std::collections::HashSet<String> = Default::default();
    let mut tx = Vec::with_capacity(shaped.len());
    for (t, auto) in &shaped {
        if *auto && t.dir == "out" {
            let cents = (t.amt * 100.0).round();
            if let Some((x, _)) = shaped.iter().find(|(x, a)| !*a && !used.contains(&x.id) && x.dir == "out" && x.account == t.account
                && (x.amt * 100.0).round() == cents && x.ym == t.ym && x.day == t.day) { used.insert(x.id.clone()); continue; }
        }
        tx.push(t.clone());
    }

    let events = live(&rows.emails).map(|e| {
        let acc = e.get("accounts").cloned().unwrap_or(Value::Null);
        Event { id: s(e, "message_id"), ts: time::parse_ts(&s(e, "received_at")).unwrap_or(0), last4: s(&acc, "last4"), typ: s(e, "kind"),
            amt: n(e, "amount").unwrap_or(0.0) / 100.0, min: n(e, "minimum_due").map(|m| m / 100.0), due: s(e, "due_date"),
            stmt: s(e, "statement_date"), src: s(e, "sender"), issuer: s(&acc, "issuer") }
    }).collect();

    let mut sv: BTreeMap<String, Value> = BTreeMap::new();
    let mut app_state: Option<&Value> = None;
    for row in &rows.settings {
        let key = s(row, "key");
        let val = row.get("value").cloned().unwrap_or(Value::Null);
        sv.insert(key.clone(), val.get("v").cloned().unwrap_or(Value::Null));
        if key == "app.state" && app_state.is_none() { app_state = row.get("value"); }
    }
    let app_version = app_state.and_then(|a| a.get("version")).and_then(|v| v.as_i64()).unwrap_or(0);
    let settings = match app_state.and_then(|a| a.get("data")).and_then(|d| d.as_object()) {
        Some(d) => d.clone(),
        None => {
            // before Phase 3: rebuilt from the Sheet's tables
            let mut cat_rules = Map::new();
            for r in live(&rows.rules) {
                let c = r.get("categories").and_then(|c| c.get("name")).and_then(|c| c.as_str()).unwrap_or("Other");
                cat_rules.insert(s(r, "pattern"), Value::from(c));
            }
            let g = |k: &str| sv.get(k).cloned().unwrap_or(Value::Null);
            let payments: Vec<Value> = live(&rows.pays).filter(|p| s(p, "matched_by") == "manual").map(|p| serde_json::json!({
                "id": s(p, "source_ref"), "card": s(p, "account_label"), "date": s(p, "paid_on"), "amt": n(p, "amount").unwrap_or(0.0) / 100.0 })).collect();
            let goals: Vec<Value> = live(&rows.goals).map(|x| serde_json::json!({ "id": x.get("id"), "name": s(x, "name"),
                "start": n(x, "start_amount").map(|v| v / 100.0).unwrap_or(0.0), "target": rupees(x, "target"), "prio": x.get("priority"), "date": x.get("target_date") })).collect();
            let contribs: Vec<Value> = live(&rows.contribs).map(|c| serde_json::json!({ "id": c.get("id"), "goal": c.get("goal_id"), "amt": rupees(c, "amount"), "date": c.get("on_date") })).collect();
            let v = serde_json::json!({ "ob": g("opening_balance"), "obAt": g("opening_balance_at"), "inc": g("take_home"), "payDay": g("payday"), "buffer": g("buffer"),
                "joined": g("joined_on"), "seeded": true, "migrated": "v4", "manual": [], "payAssign": {}, "payments": payments, "goals": goals,
                "contribs": contribs, "overrides": {}, "catRules": cat_rules });
            v.as_object().cloned().unwrap_or_default()
        }
    };
    Data { notes_ok: rows.edits.ok, notes: rows.edits.notes.clone(), payee_rules: rows.edits.rules.clone(),
        last_run: rows.last_sync.as_deref().and_then(time::parse_ts), tx, events, app_version, settings }
}

/// The demo data (tools/demo/demo-fixture.json) as Rows: the tables under their Supabase names.
pub fn rows_from_fixture(f: &Value) -> Rows {
    let list = |k: &str| f.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let edits = shape_edits(&list("payee_rules"), &list("txn_notes"));
    Rows { tx: list("transactions"), emails: list("card_emails"), pays: list("card_payments"), goals: list("goals"), contribs: list("goal_contributions"),
        rules: list("rules"), settings: list("settings"),
        last_sync: f.get("ingest_log").and_then(|l| l.get(0)).and_then(|r| r.get("received_at")).and_then(|r| r.as_str()).map(String::from), edits }
}
