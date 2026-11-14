/**
 * The alerts that are due right now, worked out from the database. Used by notify (web push, every hour) and by
 * device (the Android app asks every hour). Each alert has a key, so it goes out once per device.
 *
 *   bill due in 3 days · tomorrow · today · overdue   (skipped once payments cover the bill)
 *   a fixed payment due tomorrow (an EMI paid from your own money, say), from your plan
 *   salary landed
 *   collector quiet for 3+ hours
 *
 * Quiet hours: nothing before 8:00 or after 22:00 IST; bill reminders wait for 9:00.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Note } from "./push.ts";

export type Plan = { key: string; note: Note };

const IST_MS = 330 * 60 * 1000, DAY = 86400000;
const istDay = (d: Date | string) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
export const rs = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso: string) => { const [, m, d] = iso.split("-"); return `${+d} ${MON[+m - 1]}`; };
/** The hour in India (0–23) at a moment. */
export const istHour = (ms: number) => new Date(ms + IST_MS).getUTCHours();
export const istToday = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

export async function planAlerts(db: SupabaseClient, OWNER: string, nowMs: number): Promise<{ due: Plan[]; why: string[] }> {
  const due: Plan[] = [], why: string[] = [];
  const hour = istHour(nowMs), today = istToday(nowMs);
  if (hour < 8 || hour >= 22) return { due, why: [`quiet hours (${hour}:00 IST)`] };

  const [{ data: accounts }, { data: groups }, { data: stmts }, { data: emails }, { data: state }] = await Promise.all([
    db.from("accounts").select("id,last4,aliases,card_group_id").eq("user_id", OWNER),
    db.from("card_groups").select("id,name").eq("user_id", OWNER),
    db.from("card_statements").select("id,card_group_id,statement_date,due_date,billed,billed_override").eq("user_id", OWNER).is("deleted_at", null),
    db.from("card_emails").select("account_id,kind,amount,received_at").eq("user_id", OWNER).eq("kind", "payment").is("deleted_at", null),
    db.from("settings").select("value").eq("user_id", OWNER).eq("key", "app.state").maybeSingle(),
  ]);
  const groupOfAccount = new Map((accounts ?? []).map((a) => [a.id, a.card_group_id]));
  const groupOfLabel = new Map<string, string>();
  for (const a of accounts ?? []) for (const al of a.aliases ?? []) groupOfLabel.set(String(al).toLowerCase(), a.card_group_id);
  // your saved settings: the profile (banks and cards) and the plan (fixed payments); see app/engine.js
  type Saved = { payments?: { card: string; date: string; amt: number }[];
    profile?: { groups?: Record<string, { short?: string; closed?: string }>; salaryText?: string; family?: string };
    cfg?: { planned?: { name: string; amt: number; due: string }[] } };
  const saved = ((state?.value as { data?: Saved })?.data ?? {}) as Saved;
  const profile = saved.profile ?? {};
  const shortName = (n: string) => String(n || "").replace(/\s+add-on|\s*·\d{4}/g, "").trim();
  const groupName = new Map((groups ?? []).map((g) => [g.id, shortName(g.name)]));

  // ---- bills: the latest statement per card, unless payments since the statement cover it
  if (hour >= 9) {
    const latest = new Map<string, { id: string; card_group_id: string; statement_date: string; due_date: string; billed: number; billed_override: number | null }>();
    for (const s of stmts ?? []) {
      const cur = latest.get(s.card_group_id);
      if (!cur || s.statement_date > cur.statement_date) latest.set(s.card_group_id, s);
    }
    const appPays = saved.payments ?? [];
    const closed = new Set(Object.values(profile.groups ?? {}).filter((g) => g && g.closed && g.closed <= today)
      .map((g) => shortName(g.short ?? "")));           // cards you've closed (the profile's closed date)
    for (const s of latest.values()) {
      if (closed.has(String(groupName.get(s.card_group_id)))) continue;
      const billed = s.billed_override ?? s.billed;
      if (!(billed > 100)) continue;
      // every payment to this card since the statement: confirmation emails + ones you recorded; the same payment
      // often arrives twice (CRED and the bank, or an email and your entry), so near-identical ones count once
      const pays = [
        ...(emails ?? []).filter((e) => groupOfAccount.get(e.account_id) === s.card_group_id && istDay(e.received_at) > s.statement_date)
          .map((e) => ({ day: istDay(e.received_at), amt: e.amount })),
        ...appPays.filter((p) => groupOfLabel.get(String(p.card).toLowerCase()) === s.card_group_id && p.date > s.statement_date)
          .map((p) => ({ day: p.date, amt: Math.round(p.amt * 100) })),
      ].sort((a, b) => a.day.localeCompare(b.day));
      const counted: { day: string; amt: number }[] = [];
      for (const p of pays) {
        const dup = counted.find((c) => Math.abs(c.amt - p.amt) <= Math.max(2500, p.amt * 0.02) && Math.abs(daysBetween(c.day, p.day)) <= 3);
        if (!dup) counted.push(p);
      }
      const paid = counted.reduce((t, p) => t + p.amt, 0);
      const left = billed - paid;
      const name = groupName.get(s.card_group_id) ?? "Card";
      if (left <= 100) { why.push(`${name}: bill paid`); continue; }
      const n = daysBetween(today, s.due_date);
      const body = `${rs(left)} left to pay${paid > 0 ? ` (of ${rs(billed)})` : ""}, due ${nice(s.due_date)}.`;
      if (n === 3) due.push({ key: `bill-3|${s.id}`, note: { title: `${name} bill due in 3 days`, body, url: "/#/cards", tag: `bill-${s.id}` } });
      else if (n === 0) due.push({ key: `bill-0|${s.id}`, note: { title: `${name} bill due today`, body, url: "/#/cards", tag: `bill-${s.id}` } });
      else if (n === 1) due.push({ key: `bill-1|${s.id}`, note: { title: `${name} bill due tomorrow`, body, url: "/#/cards", tag: `bill-${s.id}` } });
      else if (n < 0 && n >= -3) due.push({ key: `bill-over|${s.id}`, note: { title: `${name} bill is overdue`, body: `${rs(left)} was due ${nice(s.due_date)}. Pay it today to avoid the late fee.`, url: "/#/cards", tag: `bill-${s.id}` } });
      else why.push(`${name}: due in ${n} days`);
    }
  }

  // ---- fixed payments from your plan (an EMI you pay from your own money, say), the day before
  const tomorrow = new Date(Date.parse(today) + DAY).toISOString().slice(0, 10);
  const family = String(profile.family ?? "").trim().toLowerCase();
  for (const p of saved.cfg?.planned ?? []) {
    if (!p || p.due !== tomorrow || !(p.amt > 0)) continue;
    if (family && String(p.name).toLowerCase().startsWith("money to " + family)) continue;   // the family share: the plan shows it
    due.push({ key: `fixed|${p.name}|${p.due}`, note: { title: `${p.name} tomorrow`,
      body: `${rs(Math.round(p.amt * 100))} on ${nice(p.due)}. It's already set aside in your plan.`, url: "/#/plan", tag: `fixed-${p.due}` } });
  }

  // ---- salary landed (your employer's credit, in the last day)
  const since = new Date(nowMs - DAY).toISOString();
  const { data: credits } = await db.from("transactions").select("id,amount,description,snippet,occurred_at,accounts!inner(kind)")
    .eq("user_id", OWNER).eq("direction", "in").gte("occurred_at", since).is("deleted_at", null).gte("amount", 2000000);
  let salaryRe = /SALARY/i;
  try { if (profile.salaryText) salaryRe = new RegExp("SALARY|" + profile.salaryText, "i"); } catch { /* keep "salary" */ }
  for (const t of credits ?? []) {
    if (!salaryRe.test(`${t.description} ${t.snippet ?? ""}`)) continue;
    due.push({ key: `salary|${t.id}`, note: { title: `Salary landed: ${rs(t.amount)}`,
      body: `Open your plan to see the split${family ? " for " + family + "," : " for"} SIP and the emergency fund.`, url: "/#/plan", tag: "salary" } });
  }

  // ---- the collector has gone quiet
  const { data: last } = await db.from("ingest_log").select("received_at").eq("user_id", OWNER).eq("kind", "sync").eq("result", "saved")
    .order("received_at", { ascending: false }).limit(1);
  const lastAt = last?.[0] ? Date.parse(last[0].received_at) : 0;
  const quietH = (nowMs - lastAt) / 3600000;
  if (quietH >= 3) {
    due.push({ key: `quiet|${today}`, note: { title: "The collector has gone quiet",
      body: `No sync from your Sheet for ${Math.floor(quietH)} hours, so new spends may be missing. In the Sheet: Money → Collect now.`, tag: "quiet" } });
  } else why.push(`collector synced ${Math.round(quietH * 60)} min ago`);

  return { due, why };
}
