//! The collector's category rules (collector/money-collector.gs: RULES, refine_ and its helpers), which rebuild each
//! transaction's description, category and "counted" flag from the bank's raw text. Kept word for word, so the Rust app
//! names and sorts a payment exactly as the current app does.

use regex::Regex;
use std::sync::OnceLock;

struct Rules { cats: Vec<(&'static str, Regex)>, cut: Regex, tail: Regex, rail: Regex, corp: Regex, upi_pre: Regex, upi_slash: Regex,
    suffix: Regex, spaces: Regex, upper: Regex, upi_payment: Regex, plain_note: Regex, refundish: Regex }

fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| {
        let r = |s: &str| Regex::new(s).unwrap();
        Rules {
            cats: vec![
                ("Cash & transfers", r(r"(?i)\b(atm|cash ?wdl|cash withdrawal|credit ?card (payment|bill)|card ?payment|billdesk|bbps|cred|cred ?club|dreamplug|ccpay|autopay|sbi ?card|sbicard|icici ?(bank )?(credit )?card)\b")),
                ("Groceries", r(r"(?i)\b(blinkit|zepto|instamart|bigbasket|big basket|dmart|jiomart|grofers|nature'?s basket|more retail|supermarket|kirana)\b")),
                ("Food & dining", r(r"(?i)\b(swiggy|zomato|eternal|district|dominos|domino'?s|kfc|mcdonald'?s?|burger king|pizza ?hut|starbucks|chaayos|haldiram'?s?|barbeque|eatclub|faasos|behrouz|box8|restaurant|cafe|dhaba|bakery|biryani|kitchen)\b")),
                ("Travel", r(r"(?i)\b(cleartrip|irctc|air ?india|indigo|interglobe|akasa|spicejet|vistara|makemytrip|make my trip|goibibo|yatra|ixigo|redbus|abhibus|uber|ola ?cabs|olacabs|rapido|blusmart|namma yatri|petrol|fuel|iocl|indian ?oil|hpcl|bpcl|fastag|toll ?plaza|dmrc|metro ?rail|railways?|oyo|airbnb|agoda)\b")),
                ("Entertainment", r(r"(?i)\b(bookmyshow|book my show|pvr|inox|cinepolis|paytm insider|steam|playstation|xbox)\b")),
                ("Bills & subscriptions", r(r"(?i)\b(google ?play|netflix|spotify|hotstar|jiohotstar|prime ?video|youtube|apple\.com|icloud|jio|airtel|vodafone|bsnl|electricity|bescom|tata ?power|broadband|fibernet|insurance|ergo|lic|policy|premium|jobcopilot|openai|chatgpt|anthropic|claude|adobe|notion|github|linkedin|gst|card charges|annual fee|recharge|e-?mandate|rent|nobroker|maintenance)\b")),
                ("Health", r(r"(?i)\b(apollo|pharmacy|pharma|pharmeasy|1mg|netmeds|hospital|clinic|diagnostics?|medplus|practo|cult\.?fit|healthkart|dental)\b")),
                ("Investments", r(r"(?i)\b(zerodha|groww|upstox|mutual ?fund|sip|indian clearing|iccl|nsccl|smallcase|angel ?one|paytm money|kuvera|motilal)\b")),
                ("Shopping", r(r"(?i)\b(amazon|flipkart|myntra|ajio|nykaa|meesho|decathlon|body ?shop|croma|reliance ?(digital|trends)|lenskart|ikea|tata ?cliq|snapdeal|uniqlo|zara|westside|shoppers stop)\b")),
            ],
            cut: r(r"(?i)\s*(Feel free|Call us|Always open|Regards,|If this (transaction|was not)|To block|Please do not|This is a (system|generated)|Reach us|Copyright|\*{3,}|E\d{6,}_\d)"),
            tail: r(r"[\s.,;:-]+$"),
            rail: r(r"(?i)^(UPI|IMPS|NEFT|RTGS)/(P2A|P2M|P2P)?/?"),
            corp: r(r"(?i)\s*\b(pvt|private|ltd|limited|india|systems?|technolog\w+)\b\.?"),
            upi_pre: r(r"(?i)^UPI-\d+-"),
            upi_slash: r(r"(?i)^UPI/"),
            suffix: r(r"([A-Za-z])(LIMITED|LTD|PRIVATE|PVT|INDIA|TECHNOLOGIES)\b"),
            spaces: r(r"\s+"),
            upper: r(r"^[A-Z0-9 &.\-]+$"),
            upi_payment: r(r"(?i)^UPI payment$"),
            plain_note: r(r"(?i)^(paid|pay|payment|upi|na|sent|transfer)$"),
            refundish: r(r"(?i)refund|reversal|cashback"),
        }
    })
}

/// Words that are money moving, not money spent.
fn not_spending(cat: &str) -> bool { cat == "Cash & transfers" || cat == "Investments" }

fn clean(s: &str) -> String { rules().spaces.replace_all(s, " ").trim().to_string() }

fn is_word(c: char) -> bool { c.is_ascii_alphanumeric() || c == '_' }

fn titleish(s: &str) -> String {
    let r = rules();
    let s = clean(s);
    let s = r.corp.replace_all(&s, " ");
    let s = r.spaces.replace_all(&s, " ").trim().to_string();
    if s.is_empty() { return s; }
    if r.upper.is_match(&s) && s.chars().count() > 3 {
        // lower case, then a capital at the start of each word (/\b[a-z]/g)
        let mut out = String::new();
        let mut prev: Option<char> = None;
        for c in s.to_lowercase().chars() {
            if c.is_ascii_lowercase() && !prev.map(is_word).unwrap_or(false) { out.push(c.to_ascii_uppercase()); } else { out.push(c); }
            prev = Some(c);
        }
        return out;
    }
    s
}

/// Axis appends support numbers, disclaimers and a copyright footer. Cut at the first of them.
fn clean_info(s: &str) -> String {
    let r = rules();
    let mut s = clean(s);
    if let Some(m) = r.cut.find(&s) { s = s[..m.start()].to_string(); }
    let s = r.tail.replace(&s, "").to_string();
    crate::fmt::take(&s, 90)
}

struct Rail { kind: String, name: String, note: String }

fn parse_rail(s: &str) -> Option<Rail> {
    let r = rules();
    r.rail.captures(s)?;
    let parts: Vec<&str> = s.split('/').collect();
    let p1 = parts.get(1).copied().unwrap_or("");
    let has_kind = ["P2A", "P2M", "P2P"].iter().any(|k| k.eq_ignore_ascii_case(p1));
    let mut name = parts.get(if has_kind { 3 } else { 2 }).copied().unwrap_or("").to_string();
    let from = if has_kind { 5 } else { 4 };
    let note = if parts.len() > from { parts[from..].join(" ").trim().to_string() } else { String::new() };
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_digit()) { name.clear(); }
    Some(Rail { kind: if has_kind { p1.to_uppercase() } else { String::new() }, name: name.trim().to_string(), note })
}

fn categorise(text: &str, kind: &str, direction: &str, rail_kind: &str, has_name: bool) -> &'static str {
    let r = rules();
    if direction == "in" { return if r.refundish.is_match(text) { "Refunds" } else { "Money in" }; }
    for (cat, re) in &r.cats {
        if *cat == "Cash & transfers" && kind == "card" { continue; }   // card-side spends are never bill payments
        if re.is_match(text) { return cat; }
    }
    if rail_kind == "P2A" || rail_kind == "P2P" { return "Transfers to people"; }
    if !has_name { return "UPI — payee unknown"; }
    "Other"
}

pub struct Refined { pub description: String, pub category: String, pub raw: String, pub counted: bool }

/// Rebuilds description, category and the counted flag from the stored raw text (refine_).
pub fn refine(kind: &str, desc: &str, raw: &str, direction: &str) -> Refined {
    let r = rules();
    let info = clean_info(raw);
    let rail = parse_rail(&info);
    let mut name = String::new();
    if let Some(ra) = &rail { name = ra.name.clone(); } else if !info.is_empty() {
        name = r.upi_slash.replace(&r.upi_pre.replace(&info, ""), "").to_string();
    }
    name = r.suffix.replace_all(&name, "${1} ${2}").to_string();

    let mut d = if !name.is_empty() { titleish(&name) } else { clean_info(desc) };
    if d.is_empty() || r.upi_payment.is_match(&d) {
        d = if rail.as_ref().map(|x| x.kind == "P2A").unwrap_or(false) { "Transfer".into() } else { "UPI payment".into() };
    }
    if let Some(ra) = &rail {
        if !ra.note.is_empty() && !r.plain_note.is_match(&ra.note) { d += &format!(" · {}", crate::fmt::take(&titleish(&ra.note), 30)); }
    }
    if desc.contains("(auto-debit)") && !d.contains("auto-debit") { d += " (auto-debit)"; }

    // Categorise on the payee and note only, never on email boilerplate.
    let text = [name.as_str(), rail.as_ref().map(|x| x.note.as_str()).unwrap_or(""), if rail.is_some() { "" } else { info.as_str() }].join(" ");
    let cat = categorise(&text, kind, direction, rail.as_ref().map(|x| x.kind.as_str()).unwrap_or(""), !name.is_empty());
    Refined { description: crate::fmt::take(&d, 60), category: cat.to_string(), raw: info, counted: direction == "out" && !not_spending(cat) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rails_and_names() {
        let x = refine("bank", "UPI", "UPI/P2M/626123/SWIGGY LIMITED/HDFC/Paid", "out");
        assert_eq!(x.description, "Swiggy"); assert_eq!(x.category, "Food & dining"); assert!(x.counted);
        let y = refine("bank", "", "UPI/P2A/626123/JATIN RAW/HDFC/Paid", "out");
        assert_eq!(y.description, "Jatin Raw"); assert_eq!(y.category, "Transfers to people");
        let z = refine("card", "HDFC ERGO (auto-debit)", "HDFC ERGO e-mandate", "out");
        assert_eq!(z.description, "HDFC ERGO e-mandate (auto-debit)"); assert_eq!(z.category, "Bills & subscriptions");
        let w = refine("bank", "", "UPI/P2M/1/ZERODHA BROKING/HDFC/sip", "out");
        assert!(!w.counted);
    }
}
