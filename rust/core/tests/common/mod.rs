//! What the checks against the current engine share: where the repository is, and a figure-by-figure diff.
#![allow(dead_code)]
use serde_json::Value;
use std::path::PathBuf;

pub fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }

/// Every difference between the JavaScript value `a` and the Rust value `b` (numbers to within 0.011).
pub fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
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
pub fn short(v: &Value) -> String { let s = v.to_string(); if s.len() > 300 { format!("{}…", &s[..300]) } else { s } }
