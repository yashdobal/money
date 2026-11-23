//! The Rust engine against the current one (app/engine.js): both work out every figure on the demo data
//! (tools/demo/demo-fixture.json) at the same moments, and the two snapshots must match to the paisa.
//! The JavaScript side runs through node (tools/rust/snapshot.mjs), so node and rn/src/engine.gen.js are needed.

use money_core::{shape, Engine};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }

/// Moments to compare: every 4 days from 1 Oct 2026 to 28 Feb 2027 at 10:00 India time, and a few late at night.
fn moments() -> Vec<i64> {
    let at = |d: &str, hm: &str| chrono::DateTime::parse_from_rfc3339(&format!("{}T{}:00+05:30", d, hm)).unwrap().timestamp_millis();
    let mut v = vec![];
    let mut t = at("2026-10-01", "10:00");
    let end = at("2027-02-28", "10:00");
    while t <= end { v.push(t); t += 4 * 86_400_000; }
    for (d, hm) in [("2026-11-30", "23:45"), ("2026-12-08", "00:10"), ("2026-12-31", "23:59"), ("2027-01-15", "18:30")] { v.push(at(d, hm)); }
    v
}

fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    if out.len() > 40 { return; }
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => { if (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() > 0.011 { out.push(format!("{}: js {} rust {}", path, x, y)); } }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() { out.push(format!("{}: js has {} items, rust {}\n   js   {}\n   rust {}", path, x.len(), y.len(), short(a), short(b))); return; }
            for (i, (p, q)) in x.iter().zip(y).enumerate() { diff(&format!("{}[{}]", path, i), p, q, out); }
        }
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x { match y.get(k) { Some(w) => diff(&format!("{}.{}", path, k), v, w, out), None => out.push(format!("{}.{}: missing in rust", path, k)) } }
            for k in y.keys() { if !x.contains_key(k) { out.push(format!("{}.{}: only in rust", path, k)); } }
        }
        _ => { if a != b { out.push(format!("{}: js {} rust {}", path, short(a), short(b))); } }
    }
}
fn short(v: &Value) -> String { let s = v.to_string(); if s.len() > 300 { format!("{}…", &s[..300]) } else { s } }

#[test]
fn same_figures_as_the_current_app() {
    let ms = moments();
    let js = Command::new("node").arg(root().join("tools/rust/snapshot.mjs")).args(ms.iter().map(|m| m.to_string()))
        .env("TZ", "Asia/Kolkata").current_dir(root()).output().expect("node runs");
    assert!(js.status.success(), "node failed: {}", String::from_utf8_lossy(&js.stderr));
    let expected: Vec<Value> = serde_json::from_slice(&js.stdout).expect("snapshot JSON");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(root().join("tools/demo/demo-fixture.json")).unwrap()).unwrap();
    let rows = shape::rows_from_fixture(&fixture);
    let mut bad = vec![];
    for e in &expected {
        let at = e["at"].as_i64().unwrap();
        let mut eng = Engine::new();
        eng.clock = Some(at);
        eng.ingest(&shape::shape_data(&rows));
        let got = eng.snapshot();
        let mut out = vec![];
        diff("", &e["snap"], &got, &mut out);
        if !out.is_empty() {
            bad.push(format!("at {} ({}):\n  {}", money_core::time::iso(at), at, out.join("\n  ")));
            if bad.len() >= 3 { break; }
        }
    }
    assert!(bad.is_empty(), "the Rust engine differs from engine.js:\n{}", bad.join("\n\n"));
    println!("{} moments, every figure the same", expected.len());
}
