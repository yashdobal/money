//! Bank SMS: one message from a bank's sender read as a payment, each SMS paired with the
//! email-based transaction for the same payment, and an SMS payment in the engine's own transaction shape. The phone
//! side (asking Android, reading the inbox, keeping what was read) is the app's (rust/app/src/sms.rs).

use crate::shape::{self, Tx};
use crate::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::OnceLock;

const DAY: i64 = 86_400_000;

/// A payment read from an SMS.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Item {
    pub id: String,
    pub ts: i64,
    pub amt: f64,
    pub dir: String,
    pub desc: String,
    /// Where, as shown: "HDFC Bank", "Axis Bank card", a card's short name.
    pub account: String,
    /// Your bank's or card account's key, when the app knows it.
    #[serde(default)]
    pub acct_key: Option<String>,
    /// The account name the email alerts use for it (to count it in the right place).
    #[serde(default)]
    pub alias: Option<String>,
    pub kind: String,
    pub body: String,
}
/* ---------------- reading a message ---------------- */
/// The banks' senders ("VM-HDFCBK", "AX-AXISBK-S", "JD-ICICIT", "BP-SBICRD"): pattern, key, name. Keep in step with
/// BANK in android/…/Sms.kt.
fn banks() -> &'static [(Regex, &'static str, &'static str)] {
    static B: OnceLock<Vec<(Regex, &'static str, &'static str)>> = OnceLock::new();
    B.get_or_init(|| vec![
        (Regex::new(r"(?i)HDFC").unwrap(), "hdfc", "HDFC Bank"), (Regex::new(r"(?i)AXIS").unwrap(), "axis", "Axis Bank"),
        (Regex::new(r"(?i)ICICI").unwrap(), "icici", "ICICI Bank"), (Regex::new(r"(?i)SBI(CRD|CARD)|SBICARD").unwrap(), "sbi", "SBI Card"),
        (Regex::new(r"(?i)AMZ|AMAZON").unwrap(), "icici", "ICICI Bank"),
    ])
}
fn re(p: &'static str) -> Regex { Regex::new(p).unwrap() }
struct Res { skip: Regex, amt: Regex, out: Regex, inn: Regex, debited: Regex, card: Regex, l4a: Regex, l4b: Regex, who: Vec<Regex>, neft: Regex, tail: Regex, space: Regex }
fn res() -> &'static Res {
    static R: OnceLock<Res> = OnceLock::new();
    R.get_or_init(|| Res {
        skip: re(r"(?i)\bOTP\b|one.?time password|is due|due date|statement|min(imum)? amount|will be debited|mandate|requested|request(ed)? money|payment (of|for) .* received|thank you for (the )?payment|reversal|declined|failed|limit (is|has)|e-?statement|reward points?"),
        amt: re(r"(?i)(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)"),
        out: re(r"(?i)\b(debited|spent|sent|withdrawn|paid|purchase|txn|transaction of)\b"),
        inn: re(r"(?i)\b(credited|received|deposited)\b"),
        debited: re(r"(?i)\bdebited\b"),
        card: re(r"(?i)\bcard\b"),
        l4a: re(r"(?i)(?:a/?c|acct|account|card)(?:\s*no\.?)?\s*(?:ending(?: with)?|xx|x|\*+)?\s*([0-9]{4})\b"),
        l4b: re(r"(?:XX|\*\*|x)(\d{4})\b"),
        who: vec![
            re(r"\bTo[: ]+([A-Za-z0-9 .&'@_-]{2,40}?)(?:\s+On\b|\s+Ref\b|\n|\.|$)"),
            re(r"(?i)\bAt[: ]+([A-Za-z0-9 .&'*_-]{2,40}?)(?:\s+On\b|\s+on\b|\.|\n|$)"),
            re(r"UPI/[A-Z0-9]+/\d+/([A-Za-z0-9 .&_-]{2,40})"),
            re(r"\bon\s+([A-Z][A-Za-z0-9 .&*_-]{2,30})\.\s"),
            re(r"(?i)VPA\s+([\w.-]+@[\w]+)"),
        ],
        neft: re(r"(?i)for (?:NEFT|IMPS|RTGS)\s*Cr-[A-Z0-9]+-([A-Za-z .&]{3,40}?)(?:-|\.|$)"),
        tail: re(r"(?i)\s+(Not you|Avl|Ref|If not|Info|Call|by UPI|via UPI)\b.*$"),
        space: re(r"\s+"),
    })
}

/// One message → a payment, or None.
pub fn parse(e: &Engine, address: &str, body: &str, ts: i64) -> Option<Item> {
    let r = res();
    let bank = banks().iter().find(|b| b.0.is_match(address))?;
    if r.skip.is_match(body) { return None; }
    let amt: f64 = r.amt.captures(body)?.get(1)?.as_str().replace(',', "").parse().ok()?;
    if !(amt > 0.0) { return None; }
    let mut dir = None;
    if r.out.is_match(body) { dir = Some("out"); }
    if r.inn.is_match(body) && !r.debited.is_match(body) { dir = Some("in"); }
    let dir = dir?;
    let card = r.card.is_match(body);
    let l4 = r.l4a.captures(body).or_else(|| r.l4b.captures(body)).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
    // where: "To NAME", "At NAME", "UPI/P2M/123/NAME", "on MERCHANT.", "VPA name@bank", a NEFT sender
    let mut who = r.who.iter().find_map(|w| w.captures(body).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()))
        .or_else(|| r.neft.captures(body).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()))
        .unwrap_or_else(|| if dir == "in" { "Money in".into() } else { "Payment".into() });
    who = r.space.replace_all(&r.tail.replace(&who, ""), " ").trim().to_string();
    if who.is_empty() { who = if dir == "in" { "Money in".into() } else { "Payment".into() }; }
    // which account: a card the app knows by its last four, else your bank account at this bank
    let first = bank.2.split(' ').next().unwrap_or("").to_lowercase();
    let mine = if card { None } else { e.banks.iter().find(|b| b.re.is_match(bank.2) || b.full.to_lowercase().starts_with(&first)) };
    let mut acct_key = mine.map(|b| b.key.clone());
    let mut account = format!("{}{}", bank.2, if card { " card" } else { "" });
    let mut alias = mine.map(|_| format!("{} Savings{}", bank.2, l4.as_ref().map(|x| format!(" XX{}", x)).unwrap_or_default()));
    if let Some(l4) = &l4 {
        if let Some((k, c)) = e.card_cfg.iter().find(|(_, c)| &c.last4 == l4) {
            acct_key = Some(c.group.clone()); account = e.card_short(&c.group); alias = Some(k.clone());
        } else if !card { account = format!("{} ··{}", bank.2, l4); }
    }
    let _ = bank.1;
    Some(Item { id: format!("sms-{}-{}", ts, (amt * 100.0).round() as i64), ts, amt, dir: dir.into(), desc: who, account, acct_key, alias,
        kind: if card { "card".into() } else { "bank".into() }, body: r.space.replace_all(body, " ").trim().to_string() })
}

/// Each SMS paired with the email-based transaction for the same payment, one to one: same direction, amount within
/// ₹1, within 36 hours (the closest in time wins). Returns the ids of the SMS that have their email.
pub fn matched(items: &[Item], tx: &[Tx]) -> std::collections::HashSet<String> {
    let mut used = std::collections::HashSet::new();
    let mut out = std::collections::HashSet::new();
    let mut v: Vec<&Item> = items.iter().collect();
    v.sort_by_key(|x| x.ts);
    for x in v {
        let mut best: Option<&Tx> = None;
        for t in tx.iter().filter(|t| !t.sms) {
            if used.contains(&t.id) || t.dir != x.dir || (t.amt - x.amt).abs() >= 1.0 { continue; }
            let gap = (t.ts - x.ts).abs();
            if (gap as f64) < 1.5 * DAY as f64 && best.map(|b| gap < (b.ts - x.ts).abs()).unwrap_or(true) { best = Some(t); }
        }
        if let Some(b) = best { used.insert(b.id.clone()); out.insert(x.id.clone()); }
    }
    out
}
/// The waiting SMS payments in the engine's own transaction shape (categorised as the email ones are).
pub fn shaped(x: &Item) -> Option<Tx> {
    let iso = chrono::DateTime::from_timestamp_millis(x.ts)?.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let row = json!({ "source_ref": x.id, "occurred_at": iso, "amount": (x.amt * 100.0).round(), "direction": x.dir, "description": x.desc,
        "counted": x.dir == "out", "snippet": x.desc, "accounts": { "kind": x.kind, "aliases": [x.alias] }, "categories": { "name": if x.dir == "in" { "Money in" } else { "Other" } } });
    let mut t = shape::shape_data(&shape::Rows { tx: vec![row], ..Default::default() }).tx.into_iter().next()?;
    t.sms = true;
    Some(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    // made-up messages in the shapes the banks send (no real accounts or people)
    const AT: i64 = 1796400000000;
    fn e() -> Engine { Engine::new() }
    #[test]
    fn reads_payments_and_skips_the_rest() {
        let e = e();
        let p = parse(&e, "VM-HDFCBK", "Sent Rs.250.00 From HDFC Bank A/C *1234 To CHAI POINT On 04/12/26 Ref 612345678901 Not You? Call 18002586161", AT).unwrap();
        assert_eq!((p.amt, p.dir.as_str(), p.desc.as_str(), p.kind.as_str()), (250.0, "out", "CHAI POINT", "bank"));
        assert_eq!(p.account, "HDFC Bank ··1234");
        let c = parse(&e, "AX-AXISBK-S", "Spent INR 1,499.50 Axis Bank Card no. XX4321 04-12-26 18:10:11 IST Amazon Avl Limit: INR 50,000", AT).unwrap();
        assert_eq!((c.amt, c.dir.as_str(), c.kind.as_str()), (1499.5, "out", "card"));
        let i = parse(&e, "JD-ICICIT", "Dear Customer, Acct XX5678 is credited with Rs 5,000.00 on 04-Dec-26 from A FRIEND. UPI:612345678901-ICICI Bank.", AT).unwrap();
        assert_eq!((i.amt, i.dir.as_str()), (5000.0, "in"));
        // an OTP, a bill reminder, a person's number: none of them payments
        assert!(parse(&e, "VM-HDFCBK", "OTP is 123456 for txn of Rs 999 at SHOP. Do not share.", AT).is_none());
        assert!(parse(&e, "BP-SBICRD", "Your SBI Card statement: total due Rs 12,000, due date 20 Dec", AT).is_none());
        assert!(parse(&e, "+919800000000", "Sent Rs.250.00 To ME", AT).is_none());
        assert!(parse(&e, "VM-HDFCBK", "Rs.0 debited", AT).is_none());
    }
    #[test]
    fn pairs_each_sms_with_its_email_once() {
        let e = e();
        let a = parse(&e, "VM-HDFCBK", "Sent Rs.250.00 From HDFC Bank A/C *1234 To CHAI POINT On 04/12/26", AT).unwrap();
        let b = parse(&e, "VM-HDFCBK", "Sent Rs.250.00 From HDFC Bank A/C *1234 To CHAI POINT On 04/12/26", AT + 3_600_000).unwrap();
        let mut t = shaped(&a).unwrap();
        t.sms = false; t.id = "email-1".into(); t.ts = AT + 600_000;
        let m = matched(&[a.clone(), b.clone()], &[t]);
        assert!(m.contains(&a.id) && !m.contains(&b.id), "one email pairs with one SMS: the closer one");
        let far = { let mut x = a.clone(); x.id = "far".into(); x.ts = AT + 3 * DAY; x };
        let mut t2 = shaped(&a).unwrap(); t2.sms = false; t2.id = "email-2".into();
        assert!(matched(&[far], &[t2]).is_empty(), "three days apart isn't the same payment");
    }
    #[test]
    fn an_sms_payment_in_the_engines_shape() {
        let p = parse(&e(), "VM-HDFCBK", "Sent Rs.250.00 From HDFC Bank A/C *1234 To CHAI POINT On 04/12/26", AT).unwrap();
        let t = shaped(&p).unwrap();
        assert!(t.sms && t.out() && t.amt == 250.0 && t.ts == AT && t.id == p.id);
    }
}
