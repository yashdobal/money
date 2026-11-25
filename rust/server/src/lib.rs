//! The Rust engine for the server (supabase/functions/_shared/engine.ts): the same figures the app shows, worked out
//! from the same rows. `build.sh` compiles it to WebAssembly and writes it into supabase/functions/_shared/money/.
//!
//! run(rows, now) takes the rows as the server reads them —
//!   {tx, emails, pays, goals, contribs, rules, settings, lastSync, editRows: {rules, notes} | null}
//! (the same selects as the app's rust/app/src/api.rs) — and the moment to work out (ms since 1970), and gives
//!   {widget: <the home-screen widget's numbers>, digest: {date, title, body}}.
use money_core::{shape, Engine};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn list(v: &Value, k: &str) -> Vec<Value> { v.get(k).and_then(|x| x.as_array()).cloned().unwrap_or_default() }

/// Works out the widget and the summary. Errors come back as {error}.
#[wasm_bindgen]
pub fn run(rows: &str, now: f64) -> String {
    let v: Value = match serde_json::from_str(rows) { Ok(v) => v, Err(e) => return json!({ "error": format!("rows: {}", e) }).to_string() };
    json!(compute(&v, now as i64)).to_string()
}

pub fn compute(v: &Value, now: i64) -> Value {
    let edits = match v.get("editRows") {
        Some(e) if e.is_object() => shape::shape_edits(&list(e, "rules"), &list(e, "notes")),
        _ => Default::default(),
    };
    let rows = shape::Rows {
        tx: list(v, "tx"), emails: list(v, "emails"), pays: list(v, "pays"), goals: list(v, "goals"), contribs: list(v, "contribs"),
        rules: list(v, "rules"), settings: list(v, "settings"), last_sync: v.get("lastSync").and_then(|x| x.as_str()).map(String::from), edits,
    };
    let mut e = Engine::new();
    e.clock = Some(now);
    e.ingest(&shape::shape_data(&rows));
    json!({ "widget": e.widget_model(), "digest": e.digest_model() })
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The demo data through the same door the server uses gives the engine's own answers.
    #[test]
    fn the_demo_through_the_server_door() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let f: Value = serde_json::from_str(&std::fs::read_to_string(root.join("tools/demo/demo-fixture.json")).unwrap()).unwrap();
        let rows = json!({ "tx": f["transactions"], "emails": f["card_emails"], "pays": f["card_payments"], "goals": f["goals"], "contribs": f["goal_contributions"],
            "rules": f["rules"], "settings": f["settings"], "lastSync": null, "editRows": { "rules": f["payee_rules"], "notes": f["txn_notes"] } });
        let at = 1796400000000i64; // 2026-12-04
        let out = compute(&rows, at);
        let mut e = Engine::new();
        e.clock = Some(at);
        e.ingest(&shape::shape_data(&shape::rows_from_fixture(&f)));
        assert_eq!(out["digest"], e.digest_model());
        assert_eq!(out["widget"]["daily"], e.widget_model()["daily"]);
        assert_eq!(out["widget"]["state"], "ok");
        let bad: Value = serde_json::from_str(&run("not json", 0.0)).unwrap();
        assert!(bad["error"].is_string());
    }
}
