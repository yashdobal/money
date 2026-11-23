//! Your account: email-code sign-in (Supabase Auth) and the same tables the current app reads (rn/src/store.js
//! getData), plus the app function (supabase/functions/app) for saving settings and asking the collector to check Gmail.
//! The keys here are the public ones every visitor's browser gets (app/public-config.json); row-level security keeps
//! each row to your login.

use gloo_net::http::{Request, Response};
use money_core::shape::{self, Rows};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CONFIG: &str = include_str!("../../../app/public-config.json");

fn config(k: &str) -> String {
    let v: Value = serde_json::from_str(CONFIG).unwrap_or(Value::Null);
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
pub fn url() -> String { config("SUPABASE_URL") }
fn key() -> String { config("SUPABASE_PUBLISHABLE_KEY") }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session { pub access_token: String, pub refresh_token: String, pub expires_at: i64, pub email: String }

async fn read(r: Result<Response, gloo_net::Error>) -> Result<(u16, Value), String> {
    let r = r.map_err(|e| format!("You're offline or the server didn't answer ({})", e))?;
    let status = r.status();
    let v = r.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, v))
}
fn err_of(v: &Value, status: u16) -> String {
    for k in ["msg", "message", "error_description", "error"] { if let Some(s) = v.get(k).and_then(|x| x.as_str()) { return s.to_string(); } }
    format!("The server said no ({})", status)
}

/// Emails you a 6-digit code (only for an account that exists).
pub async fn send_code(email: &str) -> Result<(), String> {
    let r = Request::post(&format!("{}/auth/v1/otp", url())).header("apikey", &key()).header("content-type", "application/json")
        .body(json!({ "email": email, "create_user": false }).to_string()).map_err(|e| e.to_string())?.send().await;
    let (s, v) = read(r).await?;
    if s >= 400 { return Err(if s == 422 || err_of(&v, s).to_lowercase().contains("signups not allowed") { "That email isn't set up for this app.".into() } else { err_of(&v, s) }); }
    Ok(())
}
fn session_of(v: &Value, email: &str) -> Result<Session, String> {
    let at = v.get("access_token").and_then(|x| x.as_str()).ok_or("No sign-in came back")?;
    let rt = v.get("refresh_token").and_then(|x| x.as_str()).unwrap_or("");
    let exp = v.get("expires_at").and_then(|x| x.as_i64()).unwrap_or_else(|| (js_sys::Date::now() / 1000.0) as i64 + v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600));
    let em = v.get("user").and_then(|u| u.get("email")).and_then(|x| x.as_str()).unwrap_or(email);
    Ok(Session { access_token: at.into(), refresh_token: rt.into(), expires_at: exp, email: em.into() })
}
/// Checks the code from the email.
pub async fn verify(email: &str, code: &str) -> Result<Session, String> {
    let r = Request::post(&format!("{}/auth/v1/verify", url())).header("apikey", &key()).header("content-type", "application/json")
        .body(json!({ "type": "email", "email": email, "token": code }).to_string()).map_err(|e| e.to_string())?.send().await;
    let (s, v) = read(r).await?;
    if s >= 400 { return Err(if s == 403 || s == 401 { "That code didn't work. Check it, or ask for a new one.".into() } else { err_of(&v, s) }); }
    session_of(&v, email)
}
/// A fresh sign-in from the long-lived one (an hour before it runs out).
pub async fn refresh(s: &Session) -> Result<Session, String> {
    let r = Request::post(&format!("{}/auth/v1/token?grant_type=refresh_token", url())).header("apikey", &key()).header("content-type", "application/json")
        .body(json!({ "refresh_token": s.refresh_token }).to_string()).map_err(|e| e.to_string())?.send().await;
    let (st, v) = read(r).await?;
    if st >= 400 { return Err(err_of(&v, st)); }
    session_of(&v, &s.email)
}

/// Every row of a table (1,000 at a time), as the current app reads it.
async fn table(s: &Session, name: &str, select: &str, order: Option<&str>) -> Result<Vec<Value>, String> {
    let mut out = vec![];
    let mut from = 0;
    loop {
        let mut q = format!("{}/rest/v1/{}?select={}&limit=1000&offset={}", url(), name, js_sys::encode_uri_component(select), from);
        if let Some(o) = order { q.push_str(&format!("&order={}.asc.nullslast", o)); }
        let r = Request::get(&q).header("apikey", &key()).header("authorization", &format!("Bearer {}", s.access_token)).send().await;
        let (st, v) = read(r).await?;
        if st >= 400 { return Err(format!("{}: {}", name, err_of(&v, st))); }
        let rows = v.as_array().cloned().unwrap_or_default();
        let n = rows.len();
        out.extend(rows);
        if n < 1000 { return Ok(out); }
        from += 1000;
    }
}
async fn get(s: &Session, path: &str) -> Result<(u16, Value), String> {
    read(Request::get(&format!("{}/rest/v1/{}", url(), path)).header("apikey", &key()).header("authorization", &format!("Bearer {}", s.access_token)).send().await).await
}

/// Everything the app shows (getData).
pub async fn load(s: &Session) -> Result<Rows, String> {
    let tx = table(s, "transactions", "source_ref,occurred_at,amount,direction,description,counted,snippet,sheet_row,deleted_at,accounts(kind,aliases),categories(name)", Some("sheet_row")).await?;
    let emails = table(s, "card_emails", "message_id,received_at,kind,amount,minimum_due,due_date,statement_date,sender,sheet_row,deleted_at,accounts(last4,issuer)", Some("sheet_row")).await?;
    let pays = table(s, "card_payments", "source_ref,account_label,paid_on,amount,matched_by,sheet_row,deleted_at", Some("sheet_row")).await?;
    let goals = table(s, "goals", "id,name,target,start_amount,target_date,priority,deleted_at", Some("created_at")).await?;
    let contribs = table(s, "goal_contributions", "id,goal_id,amount,on_date,deleted_at", Some("on_date")).await?;
    let rules = table(s, "rules", "pattern,deleted_at,categories(name)", Some("priority")).await?;
    let settings = table(s, "settings", "key,value", None).await?;
    let (_, log) = get(s, "ingest_log?select=received_at&kind=eq.sync&result=eq.saved&order=received_at.desc&limit=1").await?;
    let last_sync = log.get(0).and_then(|r| r.get("received_at")).and_then(|x| x.as_str()).map(String::from);
    // your notes and payee rules (their own tables; until they exist, the saved settings hold them)
    let (rs, r) = get(s, "payee_rules?select=pattern,category").await?;
    let (ns, n) = get(s, "txn_notes?select=txn_ref,category,for_someone_else,paid_back,note").await?;
    let edits = if rs < 400 && ns < 400 { shape::shape_edits(r.as_array().map(|a| a.as_slice()).unwrap_or(&[]), n.as_array().map(|a| a.as_slice()).unwrap_or(&[])) } else { Default::default() };
    Ok(Rows { tx, emails, pays, goals, contribs, rules, settings, last_sync, edits })
}

/// The app function: {action: "save" | "refresh" | …}. Returns (status, body).
pub async fn call_app(s: &Session, body: Value) -> Result<(u16, Value), String> {
    read(Request::post(&format!("{}/functions/v1/app", url())).header("apikey", &key()).header("authorization", &format!("Bearer {}", s.access_token))
        .header("content-type", "application/json").body(body.to_string()).map_err(|e| e.to_string())?.send().await).await
}
/// When the collector last saved a sync (to see a refresh land).
pub async fn last_sync(s: &Session) -> Option<i64> {
    let (_, v) = get(s, "ingest_log?select=received_at&kind=eq.sync&result=eq.saved&order=received_at.desc&limit=1").await.ok()?;
    v.get(0).and_then(|r| r.get("received_at")).and_then(|x| x.as_str()).and_then(money_core::time::parse_ts)
}
