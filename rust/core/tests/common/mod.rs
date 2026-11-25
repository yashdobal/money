//! What the checks against the current engine share: where the repository is, and a figure-by-figure diff.
#![allow(dead_code)]
use serde_json::Value;
use std::path::PathBuf;

pub fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }

/// Every difference between the JavaScript value `a` and the Rust value `b` (numbers to within 0.011).
pub fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    if out.len() > 40 { return; }
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => { if (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() > 0.011 { out.push(format!("{}: recorded {} now {}", path, x, y)); } }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() { out.push(format!("{}: recorded {} items, now {}\n   recorded {}\n   now      {}", path, x.len(), y.len(), short(a), short(b))); return; }
            for (i, (p, q)) in x.iter().zip(y).enumerate() { diff(&format!("{}[{}]", path, i), p, q, out); }
        }
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x { match y.get(k) { Some(w) => diff(&format!("{}.{}", path, k), v, w, out), None => out.push(format!("{}.{}: missing in rust", path, k)) } }
            for k in y.keys() { if !x.contains_key(k) { out.push(format!("{}.{}: only in rust", path, k)); } }
        }
        _ => { if a != b { out.push(format!("{}: recorded {} now {}", path, short(a), short(b))); } }
    }
}
pub fn short(v: &Value) -> String { let s = v.to_string(); if s.len() > 300 { format!("{}…", &s[..300]) } else { s } }

/// The reference answers (tests/golden/NAME.json.gz): recorded from the original JavaScript engine before it was
/// retired, on the demo data. A change that means to alter a figure rewrites them on purpose:
/// `UPDATE_GOLDEN=1 cargo test -p money-core`, then review the change in what the app shows.
pub fn golden(name: &str) -> Vec<Value> {
    use std::io::Read;
    let p = root().join(format!("rust/core/tests/golden/{}.json.gz", name));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(&p).unwrap_or_else(|_| panic!("{} is missing", p.display()))).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}
pub fn updating() -> bool { std::env::var("UPDATE_GOLDEN").map(|v| v == "1").unwrap_or(false) }
pub fn write_golden(name: &str, v: &[Value]) {
    use std::io::Write;
    let p = root().join(format!("rust/core/tests/golden/{}.json.gz", name));
    let mut z = flate2::write::GzEncoder::new(std::fs::File::create(&p).unwrap(), flate2::Compression::best());
    z.write_all(serde_json::to_string(v).unwrap().as_bytes()).unwrap();
    z.finish().unwrap();
    println!("wrote {}", p.display());
}
