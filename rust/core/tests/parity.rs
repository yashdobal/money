//! Every figure on the demo data (tools/demo/demo-fixture.json) at 42 moments, what each screen says, the widget and
//! the 9 PM summary, against the recorded answers (tests/golden/snapshot.json.gz, first recorded from the original
//! JavaScript engine): they must match to the paisa.

use money_core::{shape, Engine};
use serde_json::Value;

mod common;
use common::{diff, golden, root, updating, write_golden};


/// Moments to compare: every 4 days from 1 Oct 2026 to 28 Feb 2027 at 10:00 India time, and a few late at night.
#[allow(dead_code)]
fn moments() -> Vec<i64> {
    let at = |d: &str, hm: &str| chrono::DateTime::parse_from_rfc3339(&format!("{}T{}:00+05:30", d, hm)).unwrap().timestamp_millis();
    let mut v = vec![];
    let mut t = at("2026-10-01", "10:00");
    let end = at("2027-02-28", "10:00");
    while t <= end { v.push(t); t += 4 * 86_400_000; }
    for (d, hm) in [("2026-11-30", "23:45"), ("2026-12-08", "00:10"), ("2026-12-31", "23:59"), ("2027-01-15", "18:30")] { v.push(at(d, hm)); }
    v
}

#[test]
fn same_figures_as_recorded() {
    let ms = moments();
    let expected = golden("snapshot");
    assert_eq!(expected.len(), ms.len(), "the recorded moments");
    let mut fresh: Vec<Value> = vec![];
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
        let scr = eng.screens();
        diff("screens", &e["screens"], &scr, &mut out);
        let mut w = eng.widget_model();
        w.as_object_mut().unwrap().remove("at");
        let server = serde_json::json!({ "widget": w, "digest": eng.digest_model() });
        diff("server", &e["server"], &server, &mut out);
        if updating() { fresh.push(serde_json::json!({ "at": at, "snap": got, "screens": scr, "server": server })); continue; }
        if !out.is_empty() {
            bad.push(format!("at {} ({}):\n  {}", money_core::time::iso(at), at, out.join("\n  ")));
            if bad.len() >= 3 { break; }
        }
    }
    if updating() { write_golden("snapshot", &fresh); return; }
    assert!(bad.is_empty(), "the engine differs from the recorded figures:\n{}", bad.join("\n\n"));
    println!("{} moments, every figure the same", expected.len());
}
