//! Changes, made by both engines one after another on the demo data (tools/rust/actions.json): after each one, what
//! it returned, the settings it saves, the writes to the notes and rules tables and every figure must be the same as
//! the current app's (tools/rust/actions.mjs). This is what keeps the Rust app from saving anything the current app
//! wouldn't.

use money_core::engine::Edit;
use money_core::{shape, Engine};
use serde_json::{Map, Value};

mod common;
use common::{diff, golden, root, updating, write_golden};

fn s(v: &Value) -> String { match v { Value::String(s) => s.clone(), Value::Null => String::new(), x => x.to_string() } }
fn merge(a: &Value, b: &Value) -> Value {
    let mut o = a.clone();
    if let (Some(oo), Some(bb)) = (o.as_object_mut(), b.as_object()) {
        for (k, v) in bb {
            let next = match (oo.get(k), v) { (Some(x), Value::Object(_)) if x.is_object() => merge(x, v), _ => v.clone() };
            oo.insert(k.clone(), next);
        }
    }
    o
}
fn fill(v: &Value, at: i64, e: &Engine) -> Value {
    match v {
        Value::String(t) if t == "$profile" => e.profile.clone(),
        Value::String(t) => {
            let re = regex::Regex::new(r"\$t(\d+)").unwrap();
            Value::String(re.replace_all(t, |c: &regex::Captures| (at + c[1].parse::<i64>().unwrap() * 1000).to_string()).into_owned())
        }
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, at, e)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, at, e))).collect::<Map<_, _>>()),
        x => x.clone(),
    }
}

/// One step, as the app would call it. Returns what it returned ("" or a message), or None when it returns nothing.
fn run(e: &mut Engine, name: &str, a: &[Value]) -> Option<String> {
    let f = |k: &str| s(&a[0][k]);
    match name {
        "setBalance" => Some(e.set_balance(&s(&a[0]), &s(&a[1]))),
        "setSetting" => { e.set_setting(&s(&a[0]), &s(&a[1])); None }
        "setPlan" => { e.set_plan(&s(&a[0]), a[1].as_f64().unwrap()); None }
        "resetPlan" => { e.reset_plan(); None }
        "planView" => { e.set_plan_view(&s(&a[0])); None }
        "addGoal" => Some(e.add_goal(&f("name"), &f("target"), &f("start"), &f("date"), &f("prio"))),
        "delGoal" => { e.del_goal(&s(&a[0])); None }
        "addContrib" => Some(e.add_contrib(&s(&a[0]), &s(&a[1]), &s(&a[2]))),
        "delContrib" => { e.del_contrib(&s(&a[0])); None }
        "addManual" => Some(e.add_manual(&f("t"), &f("amt"), &f("c"), &f("date"), &f("acct"), &f("dir"))),
        "editManual" => { e.edit_manual(&s(&a[0]), a[1]["t"].as_str(), a[1]["amt"].as_f64()); None }
        "delManual" => { e.del_manual(&s(&a[0])); None }
        "reverse" => Some(e.reverse(&s(&a[0]))),
        "unreverse" => { e.unreverse(&s(&a[0])); None }
        "assignPayment" => { e.assign_payment(&s(&a[0]), &s(&a[1])); None }
        "notCardPayment" => { e.not_card_payment(&s(&a[0])); None }
        "addPayment" => Some(e.add_payment(&s(&a[0]), &s(&a[1]), &s(&a[2]))),
        "delPayment" => { e.del_payment(&s(&a[0])); None }
        "setStatement" => Some(e.set_statement(&s(&a[0]), &s(&a[1]))),
        "clearStatement" => { e.clear_statement(&s(&a[0])); None }
        "setCfgField" => { e.set_cfg_field(&s(&a[0]), a[1].clone()); None }
        "addPlanned" => Some(e.add_planned(&f("name"), &f("amt"), &f("due"), &f("n"), &f("from"))),
        "delPlanned" => { e.del_planned(a[0].as_u64().unwrap() as usize); None }
        "useTakeHome" => { e.use_take_home(); None }
        "resetCfg" => { e.reset_cfg(); None }
        "setRule" => { let c = s(&a[1]); e.set_rule(&s(&a[0]), Some(c.as_str())); None }
        "delRule" => { e.del_rule(&s(&a[0])); None }
        "saveEdit" => {
            let x = &a[1];
            Some(e.save_edit(&s(&a[0]), &Edit { category: s(&x["category"]), always: x["always"] == true, rule_was: x["ruleWas"] == true,
                for_other: x["forOther"] == true, paid_back: x["paidBack"] == true, note: s(&x["note"]) }))
        }
        "setProfile" => { let p = merge(&e.profile, &a[0]["merge"]); e.set_profile(&p); None }
        "importSetup" => Some(e.import_setup(&a[0])),
        "setTrip" => { e.set_trip(&s(&a[0]), a[1].clone()); None }
        "setTripCard" => { e.set_trip_card(&s(&a[0]), a[1] == true, a[2].as_f64().unwrap_or(0.0)); None }
        "resetTrip" => { e.reset_trip(); None }
        "setRew" => { e.set_rew(&s(&a[0]), if a[1].is_null() { None } else { Some(a[1].clone()) }); None }
        "override" => { e.set_override(&s(&a[0]), Some(a[1].clone())); None }
        _ => panic!("no step called {}", name),
    }
}

#[test]
fn same_changes_as_the_current_app() {
    let expected = golden("actions");
    let mut fresh: Vec<Value> = vec![];
    let script: Value = serde_json::from_str(&std::fs::read_to_string(root().join("tools/rust/actions.json")).unwrap()).unwrap();
    let at = chrono::DateTime::parse_from_rfc3339(script["at"].as_str().unwrap()).unwrap().timestamp_millis();
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(root().join("tools/demo/demo-fixture.json")).unwrap()).unwrap();
    let mut e = Engine::new();
    e.clock = Some(at);
    e.ingest(&shape::shape_data(&shape::rows_from_fixture(&fixture)));
    let steps = script["steps"].as_array().unwrap();
    assert_eq!(steps.len(), expected.len());
    for (i, (step, js)) in steps.iter().zip(&expected).enumerate() {
        e.clock = Some(at + i as i64 * 1000);
        let st = step.as_array().unwrap();
        let name = st[0].as_str().unwrap();
        let args: Vec<Value> = st[1..].iter().map(|v| fill(v, at, &e)).collect();
        let ret = run(&mut e, name, &args);
        let mut out = vec![];
        let ret = ret.map(Value::String).unwrap_or(Value::Null);
        let blob = e.save_blob();
        let writes = serde_json::to_value(std::mem::take(&mut e.outbox)).unwrap();
        let (snap, screens) = (e.snapshot(), e.screens());
        if updating() { fresh.push(serde_json::json!({ "ret": ret, "blob": blob, "writes": writes, "snap": snap, "screens": screens })); continue; }
        diff("ret", &js["ret"], &ret, &mut out);
        diff("saved", &js["blob"], &blob, &mut out);
        diff("writes", &js["writes"], &writes, &mut out);
        diff("figures", &js["snap"], &snap, &mut out);
        diff("screens", &js["screens"], &screens, &mut out);
        assert!(out.is_empty(), "step {} ({} {}) differs from engine.js:\n  {}", i, name, serde_json::to_string(&st[1..]).unwrap(), out.join("\n  "));
    }
    if updating() { write_golden("actions", &fresh); return; }
    println!("{} changes, each saved and worked out the same", steps.len());
}
