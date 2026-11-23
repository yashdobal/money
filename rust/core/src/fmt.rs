//! Numbers and text the way JavaScript does them in the app: Math.round, toLocaleString("en-IN") (1,23,456),
//! and string slices counted in characters.

/// JavaScript's Math.round: halves go up (Math.round(-2.5) is -2).
pub fn round(x: f64) -> f64 { (x + 0.5).floor() }

/// Indian digit grouping of a whole number: 1234567 → "12,34,567".
pub fn group_in(n: u64) -> String {
    let s = n.to_string();
    if s.len() <= 3 { return s; }
    let (head, tail) = s.split_at(s.len() - 3);
    let mut parts: Vec<String> = Vec::new();
    let hb = head.as_bytes();
    let mut i = hb.len();
    while i > 0 {
        let start = i.saturating_sub(2);
        parts.push(head[start..i].to_string());
        i = start;
    }
    parts.reverse();
    format!("{},{}", parts.join(","), tail)
}
/// toLocaleString("en-IN") of a number (at most 3 decimals, trailing zeros dropped).
pub fn locale_in(x: f64) -> String {
    let neg = x < 0.0;
    let a = (x.abs() * 1000.0).round() / 1000.0;
    let whole = a.trunc() as u64;
    let frac = ((a - a.trunc()) * 1000.0).round() as u64;
    let mut s = group_in(whole);
    if frac > 0 {
        let f = format!("{:03}", frac);
        s.push('.');
        s.push_str(f.trim_end_matches('0'));
    }
    if neg { format!("-{}", s) } else { s }
}
/// "₹1,23,456" (whole rupees); a minus sign for less than zero: "−₹500".
pub fn money(n: f64) -> String {
    format!("{}₹{}", if n < 0.0 { "−" } else { "" }, group_in(round(n.abs()) as u64))
}
/// "₹1,234.50".
pub fn money2(n: f64) -> String {
    let c = (n.abs() * 100.0).round() as u64;
    format!("{}₹{}.{:02}", if n < 0.0 { "-" } else { "" }, group_in(c / 100), c % 100)
}
/// s.slice(0, n) in characters.
pub fn take(s: &str, n: usize) -> String { s.chars().take(n).collect() }
pub fn plural(n: i64, word: &str) -> String { format!("{} {}{}", n, word, if n == 1 { "" } else { "s" }) }
/// "a, b and c".
pub fn and_list(a: &[String]) -> String {
    match a.len() {
        0 => String::new(),
        1 => a[0].clone(),
        n => format!("{} and {}", a[..n - 1].join(", "), a[n - 1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indian() {
        assert_eq!(group_in(999), "999");
        assert_eq!(group_in(1000), "1,000");
        assert_eq!(group_in(123456), "1,23,456");
        assert_eq!(group_in(12345678), "1,23,45,678");
        assert_eq!(money(-500.4), "−₹500");
        assert_eq!(money(2869.83), "₹2,870");
        assert_eq!(money2(2869.5), "₹2,869.50");
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(locale_in(1999.5), "1,999.5");
    }
}
