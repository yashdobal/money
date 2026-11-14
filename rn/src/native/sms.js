/* Bank SMS (Android): when you turn it on, Money RN reads your bank's text messages (only ones from banks, only
   payments) so a payment shows the moment the SMS lands, before the bank's email. Each one waits in Activity, marked
   "from SMS", until the email-based transaction appears (same amount and direction within a day and a half), then it
   drops away so nothing counts twice. Nothing from SMS is sent anywhere; it stays on the phone. */
import { PermissionsAndroid, Platform } from "react-native";
import { E, pref, storage, bump } from "../store";
import { readSms, canReadSms } from "../../modules/money-native/src";

const DAY = 86400000;
/* senders look like "VM-HDFCBK", "AX-AXISBK-S", "JD-ICICIT", "BP-SBICRD" */
const BANKS = [[/HDFC/i, "hdfc", "HDFC Bank"], [/AXIS/i, "axis", "Axis Bank"], [/ICICI/i, "icici", "ICICI Bank"], [/SBI(CRD|CARD)|SBICARD/i, "sbi", "SBI Card"], [/AMZ|AMAZON/i, "icici", "ICICI Bank"]];
const SKIP = /\bOTP\b|one.?time password|is due|due date|statement|min(imum)? amount|will be debited|mandate|requested|request(ed)? money|payment (of|for) .* received|thank you for (the )?payment|reversal|declined|failed|limit (is|has)|e-?statement|reward points?/i;

export const enabled = () => Platform.OS === "android" && pref.get("sms", "0") === "1" && canReadSms();

/** Turn SMS reading on (asks Android first) or off. Returns a message for a toast, or null. */
export async function setEnabled(on) {
  if (Platform.OS !== "android") return "Only on Android";
  if (!on) { pref.set("sms", null); storage.removeItem("money-sms"); bump(); return "Bank SMS off"; }
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: "Read your bank SMS?", message: "Money RN reads payment messages from your banks so payments show straight away. They stay on this phone.", buttonPositive: "Allow", buttonNegative: "Not now",
  }).catch(() => "denied");
  if (r !== PermissionsAndroid.RESULTS.GRANTED) return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "Allow SMS for Money RN in Android's settings, then try again." : "SMS stays off";
  pref.set("sms", "1");
  scan();
  return "Bank SMS on: payments from SMS show in Activity";
}

const num = (s) => parseFloat(String(s).replace(/,/g, ""));
/** One message → a payment, or null. */
export function parse(address, body, ts) {
  const bank = BANKS.find((b) => b[0].test(address));
  if (!bank || SKIP.test(body)) return null;
  const am = body.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!am) return null;
  const amtV = num(am[1]);
  if (!(amtV > 0)) return null;
  let dir = null;
  if (/\b(debited|spent|sent|withdrawn|paid|purchase|txn|transaction of)\b/i.test(body)) dir = "out";
  if (/\b(credited|received|deposited)\b/i.test(body) && !/\bdebited\b/i.test(body)) dir = "in";
  if (!dir) return null;
  const card = /\bcard\b/i.test(body);
  const l4 = (body.match(/(?:a\/?c|acct|account|card)(?:\s*no\.?)?\s*(?:ending(?: with)?|xx|x|\*+)?\s*([0-9]{4})\b/i) || body.match(/(?:XX|\*\*|x)(\d{4})\b/) || [])[1];
  // where: "To NAME", "At NAME", "on MERCHANT.", "UPI/P2M/123/NAME", "VPA name@bank"
  let who = (body.match(/\bTo[: ]+([A-Za-z0-9 .&'@_-]{2,40}?)(?:\s+On\b|\s+Ref\b|\n|\.|$)/) || body.match(/\bAt[: ]+([A-Za-z0-9 .&'*_-]{2,40}?)(?:\s+On\b|\s+on\b|\.|\n|$)/i)
    || body.match(/UPI\/[A-Z0-9]+\/\d+\/([A-Za-z0-9 .&_-]{2,40})/) || body.match(/\bon\s+([A-Z][A-Za-z0-9 .&*_-]{2,30})\.\s/) || body.match(/VPA\s+([\w.-]+@[\w]+)/i) || [])[1];
  if (!who) who = (body.match(/for (?:NEFT|IMPS|RTGS)\s*Cr-[A-Z0-9]+-([A-Za-z .&]{3,40}?)(?:-|\.|$)/i) || [])[1];
  who = (who || (dir === "in" ? "Money in" : "Payment")).replace(/\s+(Not you|Avl|Ref|If not|Info|Call|by UPI|via UPI)\b.*$/i, "").replace(/\s+/g, " ").trim();
  // which account: a card the app knows by its last four, else the bank account
  // a bank account of yours at this bank (your profile's banks, by the start of the name the alerts use)
  const mine = card ? null : (E.BANKS || []).find((b) => b.re.test(bank[2]) || new RegExp("^" + bank[2].split(" ")[0], "i").test(b.full));
  let acctKey = mine ? mine.key : null, account = bank[2] + (card ? " card" : "");
  let alias = mine ? bank[2] + " Savings" + (l4 ? " XX" + l4 : "") : null;
  if (l4) {
    const k = Object.keys(E.CARD_CFG || {}).find((m) => E.CARD_CFG[m].last4 === l4);
    if (k) { const g = E.CARD_CFG[k].group; acctKey = g; account = E.cardShort(g); alias = k; }
    else if (!card) account = bank[2] + " ··" + l4;
  }
  const d = new Date(ts);
  return { id: "sms-" + ts + "-" + Math.round(amtV * 100), ts, amt: amtV, dir, desc: who, account, acctKey, alias, kind: card ? "card" : "bank", body: body.replace(/\s+/g, " ").trim(),
    ym: E.ymOf(d), day: d.getDate(), time: ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2), cat: dir === "in" ? "Money in" : "UPI — payee unknown", counted: false, sms: true };
}

const read = () => { try { return JSON.parse(storage.getItem("money-sms") || "{}"); } catch (e) { return {}; } };
const write = (o) => storage.setItem("money-sms", JSON.stringify(o));

/** Read new messages (on opening the app, coming back to it, and pulling to refresh). */
export function scan() {
  if (!enabled()) return;
  const st = read(), keepFrom = Math.min(Date.now() - 3 * DAY, trialStart() || Infinity);
  const since = Math.max(st.last || 0, keepFrom);
  const msgs = readSms(since, 300) || [];
  const items = st.items || [], unread = st.unread || [];
  msgs.forEach((m) => {
    const p = parse(m.address, m.body, m.date);
    if (p) { if (!items.some((x) => x.id === p.id)) items.push(p); }
    // a bank SMS with an amount that isn't a skip-type message but couldn't be read as a payment: for the scorecard
    else if (BANKS.some((b) => b[0].test(m.address)) && /(?:Rs\.?|INR|₹)\s*[\d,]/i.test(m.body) && !SKIP.test(m.body) && !unread.includes(m.date)) unread.push(m.date);
  });
  write({ last: msgs.length ? Math.max(since, ...msgs.map((m) => m.date)) : since, items: items.filter((x) => x.ts > keepFrom).slice(-500),
    hidden: st.hidden || [], unread: unread.filter((d) => d > keepFrom).slice(-200) });
  inject();
  bump();
}

/** Each SMS paired with the email-based transaction for the same payment, one to one: same direction, amount
    within ₹1, within 36 hours (the closest in time wins). Returns {smsId: tx}. */
function matchAll(items) {
  const used = new Set(), out = {};
  const email = E.TX.filter((t) => !t.sms);
  items.slice().sort((a, b) => a.ts - b.ts).forEach((x) => {
    let best = null;
    email.forEach((t) => {
      if (used.has(t.id) || t.dir !== x.dir || Math.abs(t.amt - x.amt) >= 1) return;
      const gap = Math.abs((t.ts || 0) - x.ts);
      if (gap < 1.5 * DAY && (!best || gap < Math.abs(best.ts - x.ts))) best = t;
    });
    if (best) { used.add(best.id); out[x.id] = best; }
  });
  return out;
}
/** The SMS payments still waiting for their email, newest first. */
export function pending() {
  if (!enabled()) return [];
  const st = read(), hide = new Set(st.hidden || []), items = (st.items || []).filter((x) => !hide.has(x.id)), m = matchAll(items);
  return items.filter((x) => !m[x.id]).sort((a, b) => b.ts - a.ts);
}
export const pendingTotal = () => pending().filter((x) => x.dir === "out").reduce((a, x) => a + x.amt, 0);
export function dismiss(id) { const st = read(); st.hidden = (st.hidden || []).concat([id]).slice(-200); write(st); inject(); bump(); }

/* ---------------- SMS first ----------------
   While it's on (a one-week trial, or kept on after it), an SMS payment counts in every figure the moment it's read:
   it joins your transactions marked "from SMS", and when the bank's email for it arrives the email takes its place
   (so nothing counts twice). Email keeps running underneath. During the trial the app times each payment both ways
   (the SMS's arrival against when its email reached the database) for the scorecard. */
const TRIAL_DAYS = 7;
export const trialStart = () => { const v = Number(pref.get("smsTrial", "0")); return v > 0 ? v : 0; };
export const trialDay = () => (trialStart() ? Math.min(TRIAL_DAYS, Math.floor((Date.now() - trialStart()) / DAY) + 1) : 0);
export const trialDone = () => !!trialStart() && Date.now() - trialStart() >= TRIAL_DAYS * DAY;
export const counting = () => enabled() && (!!trialStart() || pref.get("smsFirst", "0") === "1");

/** Start the week (turns SMS reading on first, which asks Android). Returns a message for a toast. */
export async function startTrial() {
  if (!enabled()) { const m = await setEnabled(true); if (!enabled()) return m; }
  const start = Date.now();
  pref.set("smsTrial", String(start));
  try {
    const N = require("expo-notifications");
    const at = new Date(start + TRIAL_DAYS * DAY); at.setHours(19, 0, 0, 0);
    await N.scheduleNotificationAsync({ identifier: "sms-trial-done", content: { title: "Your SMS week is done", body: "See how SMS compared with email: which was faster and what each one missed.", data: { url: "#/settings?sheet=sms-trial" } },
      trigger: { type: "date", date: at, channelId: "alerts" } });
  } catch (e) {}
  scan();
  return "SMS first for a week: payments count the moment the SMS arrives";
}
/** After the week: keep SMS first, or go back to email only (SMS still shows, it just waits for the email). */
export function endTrial(keep) {
  const st = read(); st.result = stats(); write(st);
  pref.set("smsTrial", null); pref.set("smsFirst", keep ? "1" : null);
  try { require("expo-notifications").cancelScheduledNotificationAsync("sms-trial-done"); } catch (e) {}
  inject(); bump();
}

/** Put the unmatched SMS payments into the engine's transactions (or take them out), then let it recompute. */
let lastSig = "";
export function inject() {
  try {
    if (!E.TX) return;
    const on = counting(), add = on ? pending().filter((x) => x.alias) : [];
    const sig = add.map((x) => x.id).join(",");
    const had = E.TX.some((t) => t.sms);
    if (sig === lastSig && (had || !add.length)) { seen(); return; }
    for (let i = E.TX.length - 1; i >= 0; i--) if (E.TX[i].sms) E.TX.splice(i, 1);
    add.forEach((x) => {
      const t = shaped(x);
      if (t) E.TX.push(t);
    });
    lastSig = sig;
    seen();
    if (E.resolvePayments) E.resolvePayments();
  } catch (e) {}
}
/** An SMS payment in the engine's own transaction shape (categorised the way the email ones are). */
function shaped(x) {
  try {
    const iso = new Date(x.ts).toISOString();
    const t = E.shapeData({ tx: [{ source_ref: x.id, occurred_at: iso, amount: Math.round(x.amt * 100), direction: x.dir, description: x.desc, counted: x.dir === "out", snippet: x.desc,
      accounts: { kind: x.kind, aliases: [x.alias] }, categories: { name: x.dir === "in" ? "Money in" : "Other" } }],
      emails: [], pays: [], stmts: [], cycles: [], goals: [], contribs: [], rules: [], settings: [], lastSync: null }).tx[0];
    return Object.assign(t, { sms: true, body: x.body });
  } catch (e) { return null; }
}

/* the scorecard's timing: when each email transaction reached the database (from the server; if that can't be read,
   when this phone first saw it) */
function seen() {
  const start = trialStart();
  if (!start) return;
  const st = read(), fs = st.firstSeen || {};
  let n = 0;
  E.TX.forEach((t) => { if (!t.sms && (t.ts || 0) >= start - DAY && !fs[t.id]) { fs[t.id] = Date.now(); n++; } });
  if (n) { st.firstSeen = fs; write(st); }
}
export async function fetchArrivals() {
  const start = trialStart();
  if (!start) return;
  try {
    const { sb } = require("../store");
    const { data, error } = await sb.from("transactions").select("source_ref,created_at").gte("created_at", new Date(start - DAY).toISOString()).limit(1000);
    if (error || !Array.isArray(data)) return;
    const st = read(), at = st.arrived || {};
    data.forEach((r) => { if (r.source_ref && r.created_at) at[r.source_ref] = Date.parse(r.created_at); });
    st.arrived = at; write(st); bump();
  } catch (e) {}
}

/** How the two compared since the trial started. */
export function stats() {
  const start = trialStart() || (read().result && read().result.start) || 0;
  if (!start) return read().result || null;
  const st = read(), hide = new Set(st.hidden || []);
  const items = (st.items || []).filter((x) => x.ts >= start && !hide.has(x.id));
  const m = matchAll(items);
  const arrived = st.arrived || {}, firstSeen = st.firstSeen || {};
  const leads = [], pairs = [];
  items.forEach((x) => {
    const t = m[x.id];
    if (!t) return;
    const emailAt = arrived[t.id] || firstSeen[t.id] || null;
    const lead = emailAt ? emailAt - x.ts : null;
    if (lead !== null) leads.push(lead);
    pairs.push({ desc: t.desc || x.desc, amt: x.amt, lead });
  });
  const matched = new Set(Object.values(m).map((t) => t.id));
  // emails for payments made after the start, old enough (6 hours) that their SMS would have come by now
  const emails = E.TX.filter((t) => !t.sms && (t.ts || 0) >= start && (t.ts || 0) < Date.now() - 6 * 3600000 && (t.kind === "card" || !!E.bankOf(t)));
  const emailOnly = emails.filter((t) => !matched.has(t.id)).map((t) => ({ desc: t.desc, amt: t.amt, ts: t.ts }));
  const smsOnly = items.filter((x) => !m[x.id] && x.ts < Date.now() - 6 * 3600000).map((x) => ({ desc: x.desc, amt: x.amt, ts: x.ts }));
  const sorted = leads.slice().sort((a, b) => a - b), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { start, day: trialDay(), both: pairs.length, smsFirst: leads.filter((l) => l > 60000).length, emailFirst: leads.filter((l) => l < -60000).length,
    timed: leads.length, median: med, max: sorted.length ? sorted[sorted.length - 1] : null, smsOnly, emailOnly, unread: (st.unread || []).filter((d) => d >= start).length };
}
