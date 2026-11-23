//! Odd data must never crash the engine (a crash in the browser freezes the app): the demo data with random fields
//! blanked, zeroed or garbled, run through everything the screens use.
use money_core::{shape, Engine};
use serde_json::{json, Value};
use std::collections::BTreeMap;
mod common;
use common::root;

struct Rng(u64);
impl Rng { fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 } fn f(&mut self) -> f64 { (self.next() % 1_000_000) as f64 / 1e6 } }

fn junk(r: &mut Rng) -> Value {
    match r.next() % 12 { 0 => Value::Null, 1 => json!(""), 2 => json!(0), 3 => json!(-5), 4 => json!("abc"), 5 => json!([]), 6 => json!({}), 7 => json!(1e15), 8 => json!("2026-13-45"), 9 => json!("₹ café 🍕 ﷽"), 10 => json!("२०२६-११"), _ => json!("ü") }
}
fn mutate(v: &mut Value, p: f64, r: &mut Rng) {
    if r.f() < p { *v = junk(r); return; }
    match v { Value::Array(a) => for x in a { mutate(x, p, r) }, Value::Object(o) => for (_, x) in o.iter_mut() { mutate(x, p, r) }, _ => {} }
}

#[test]
fn odd_data_never_crashes() {
    let base: Value = serde_json::from_str(&std::fs::read_to_string(root().join("tools/demo/demo-fixture.json")).unwrap()).unwrap();
    let n: u64 = std::env::var("FUZZ_N").ok().and_then(|x| x.parse().ok()).unwrap_or(150);
    let at = chrono::DateTime::parse_from_rfc3339("2026-12-08T10:00:00+05:30").unwrap().timestamp_millis();
    let mut found: BTreeMap<String, u64> = BTreeMap::new();
    static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    std::panic::set_hook(Box::new(|i| { *LAST.lock().unwrap() = i.to_string().replace('\n', " "); }));
    for seed in 1..=n {
        let mut r = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1);
        let p = [0.0005, 0.002, 0.01][(seed % 3) as usize];
        let mut f = base.clone();
        mutate(&mut f, p, &mut r);
        let t0 = std::time::Instant::now();
        let res = std::panic::catch_unwind(|| {
            let rows = shape::rows_from_fixture(&f);
            let mut e = Engine::new();
            e.clock = Some(at);
            e.ingest(&shape::shape_data(&rows));
            let _ = e.snapshot();
            let _ = e.screens();
        });
        if t0.elapsed().as_millis() > 300 { eprintln!("seed {} slow: {} ms", seed, t0.elapsed().as_millis()); }
        if let Err(x) = res {
            let _ = x;
            let m = LAST.lock().unwrap().clone();
            *found.entry(m.chars().take(200).collect()).or_default() += 1;
            if found.len() == 1 && found.values().sum::<u64>() == 1 { std::fs::write("/tmp/fuzz-first-seed.txt", seed.to_string()).ok(); }
        }
    }
    let _ = std::panic::take_hook();
    eprintln!("(done {} seeds)", n);
    eprintln!("CRASHES: {:#?}", found);
    assert!(found.is_empty());
}
