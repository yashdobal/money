//! Dates as the app sees them: India time (UTC+5:30, no daylight saving), the way app/engine.js reads `new Date()` on a
//! phone in India. A moment is milliseconds since 1970 (UTC), as in JavaScript; a "local date" is that moment read in
//! India time. `local(y, m, d)` behaves like `new Date(y, m, d)`: a month or day past the end rolls over.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};

pub type Ms = i64;
pub const OFF: Ms = 330 * 60_000;
pub const DAY: Ms = 86_400_000;
/// -Infinity / Infinity for time windows.
pub const NEG_INF: Ms = i64::MIN / 4;
pub const POS_INF: Ms = i64::MAX / 4;

pub const MON: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
pub const MONFULL: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
pub const DOW: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

fn naive(ms: Ms) -> NaiveDateTime {
    chrono::DateTime::from_timestamp_millis(ms + OFF).map(|d| d.naive_utc()).unwrap_or_default()
}

/// The local (India) calendar parts of a moment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Parts { pub y: i32, pub m: i32, pub d: i32, pub h: i32, pub mi: i32, pub s: i32, pub dow: i32 }

pub fn parts(ms: Ms) -> Parts {
    let n = naive(ms);
    Parts { y: n.year(), m: n.month0() as i32, d: n.day() as i32, h: n.hour() as i32, mi: n.minute() as i32, s: n.second() as i32,
        dow: n.weekday().num_days_from_sunday() as i32 }
}
pub fn year(ms: Ms) -> i32 { parts(ms).y }
pub fn month(ms: Ms) -> i32 { parts(ms).m }
pub fn date(ms: Ms) -> i32 { parts(ms).d }
pub fn dow(ms: Ms) -> i32 { parts(ms).dow }

/// `new Date(y, m, d, h, mi, s)` in India time, rolling over like JavaScript.
pub fn local_full(y: i32, m: i32, d: i32, h: i64, mi: i64, s: i64) -> Ms {
    // checked all the way: odd data (a date far out of range) gives 1 Jan 1970 rather than a crash
    let go = || -> Option<Ms> {
        let yy = y.checked_add(m.div_euclid(12))?;
        let mm = m.rem_euclid(12);
        let base = NaiveDate::from_ymd_opt(yy, (mm + 1) as u32, 1)?;
        let day = base.checked_add_signed(Duration::try_days((d as i64) - 1)?)?;
        let secs = h.checked_mul(3600)?.checked_add(mi.checked_mul(60)?)?.checked_add(s)?;
        let t = day.and_hms_opt(0, 0, 0)?.checked_add_signed(Duration::try_seconds(secs)?)?;
        Some(t.and_utc().timestamp_millis() - OFF)
    };
    go().unwrap_or(-OFF)
}
pub fn local(y: i32, m: i32, d: i32) -> Ms { local_full(y, m, d, 0, 0, 0) }

/// Start of the local day.
pub fn sod(ms: Ms) -> Ms { let p = parts(ms); local(p.y, p.m, p.d) }
pub fn add_days(ms: Ms, n: i32) -> Ms { let p = parts(ms); local(p.y, p.m, p.d.saturating_add(n)) }
/// Days in a month (m may roll over).
pub fn month_days(y: i32, m: i32) -> i32 { parts(local(y, m + 1, 0)).d }
/// That day of a month, or the month's last day if it's shorter (onDay in engine.js).
pub fn on_day(y: i32, m: i32, day: i32) -> Ms {
    let yy = y.saturating_add(m.div_euclid(12));
    let mm = m.rem_euclid(12);
    local(yy, mm, day.min(month_days(yy, mm)))
}
/// "2026-11-23".
pub fn iso(ms: Ms) -> String { let p = parts(ms); format!("{:04}-{:02}-{:02}", p.y, p.m + 1, p.d) }
/// "2026-11".
pub fn ym_of(ms: Ms) -> String { let p = parts(ms); format!("{:04}-{:02}", p.y, p.m + 1) }
pub fn is_iso(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}
/// "YYYY-MM-DD" at local midnight (parseISO).
pub fn parse_iso(s: &str) -> Option<Ms> {
    if !is_iso(s) { return None; }
    let y: i32 = s[0..4].parse().ok()?;
    let m: i32 = s[5..7].parse().ok()?;
    let d: i32 = s[8..10].parse().ok()?;
    if !(1..=12).contains(&m) || d < 1 || d > month_days(y, m - 1) { return None; }
    Some(local(y, m - 1, d))
}
/// "YYYY-MM-DD" at a local hour (new Date(s + "T12:00:00")).
pub fn parse_iso_at(s: &str, h: i64) -> Option<Ms> { parse_iso(s).map(|t| t + h * 3_600_000) }
/// An ISO timestamp from the database ("2026-11-05T13:23:38+00:00", "...Z", or with a fraction).
pub fn parse_ts(s: &str) -> Option<Ms> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis())
        .or_else(|| chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f%#z").ok().map(|d| d.timestamp_millis()))
        .or_else(|| chrono::DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f%#z").ok().map(|d| d.timestamp_millis()))
        .or_else(|| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f").ok().map(|d| d.and_utc().timestamp_millis()))
}
/// "5 Nov".
pub fn fmt(ms: Ms) -> String { let p = parts(ms); format!("{} {}", p.d, MON[p.m as usize]) }
/// "5 Nov 2026".
pub fn fmt_y(ms: Ms) -> String { format!("{} {}", fmt(ms), year(ms)) }
/// "Thu 5 Nov".
pub fn fmt_d(ms: Ms) -> String { format!("{} {}", DOW[dow(ms) as usize], fmt(ms)) }
/// Whole days from a to b (local days).
pub fn days(a: Ms, b: Ms) -> i32 { (((sod(b) - sod(a)) as f64) / DAY as f64).round() as i32 }
pub fn ordinal(n: i32) -> String {
    // engine.js: s[(v - 20) % 10] || s[v] || s[0]
    let s = ["th", "st", "nd", "rd"];
    let v = n % 100;
    let suf = if v >= 20 && (v - 20) % 10 < 4 { s[((v - 20) % 10) as usize] } else if (0..4).contains(&v) { s[v as usize] } else { s[0] };
    format!("{}{}", n, suf)
}
/// The year and month (1–12) of "2026-11", without crashing on anything odd (1970-01 then).
pub fn ym_parts(ym: &str) -> (i32, i32) {
    let y = ym.get(0..4).and_then(|x| x.parse().ok()).unwrap_or(1970);
    let m = ym.get(5..7).and_then(|x| x.parse().ok()).filter(|m| (1..=12).contains(m)).unwrap_or(1);
    (y, m)
}
/// "2026-11" plus n months.
pub fn ym_add(ym: &str, n: i32) -> String {
    let (y, m) = ym_parts(ym);
    let t = local(y, m - 1 + n, 1);
    ym_of(t)
}
/// "November 2026".
pub fn ym_name(ym: &str) -> String {
    let (y, m) = ym_parts(ym);
    format!("{} {}", MONFULL[(m - 1) as usize], y)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn india_time() {
        let t = parse_ts("2026-11-05T13:23:38Z").unwrap();
        assert_eq!(iso(t), "2026-11-05");
        assert_eq!(parts(t).h, 18);
        let t2 = parse_ts("2026-11-05T19:00:00+00:00").unwrap();
        assert_eq!(iso(t2), "2026-11-06");
        assert_eq!(iso(local(2026, 1, 31)), "2026-03-03");
        assert_eq!(iso(on_day(2026, 1, 31)), "2026-02-28");
        assert_eq!(iso(on_day(2026, -1, 15)), "2025-12-15");
        assert_eq!(iso(add_days(parse_iso("2026-12-30").unwrap(), 5)), "2027-01-04");
        assert_eq!(fmt_d(parse_iso("2026-11-23").unwrap()), "Mon 23 Nov");
        assert_eq!(days(parse_iso("2026-11-01").unwrap(), parse_iso("2026-12-01").unwrap()), 30);
        assert_eq!(ordinal(1), "1st"); assert_eq!(ordinal(2), "2nd"); assert_eq!(ordinal(3), "3rd"); assert_eq!(ordinal(4), "4th");
        assert_eq!(ordinal(11), "11th"); assert_eq!(ordinal(12), "12th"); assert_eq!(ordinal(21), "21st"); assert_eq!(ordinal(22), "22nd");
        assert_eq!(ordinal(31), "31st"); assert_eq!(ordinal(13), "13th");
        assert_eq!(ym_add("2026-11", 3), "2027-02");
    }
}
