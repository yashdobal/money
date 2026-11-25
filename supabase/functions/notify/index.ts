/**
 * notify — runs every hour (pg_cron → pg_net) and sends the phone alerts that are due. Each alert goes out once.
 *
 *   bill due in 3 days · tomorrow · today · overdue   (skipped once payments cover the bill)
 *   a fixed payment due tomorrow, from your plan
 *   salary landed
 *   collector quiet for 3+ hours
 *
 *   the 9 PM summary (the app's own engine on your data, see _shared/engine.ts), in the 21:00 run
 *
 * Quiet hours: nothing before 8:00 or after 22:00 IST; bill reminders wait for 9:00. The 3 AM run prunes sync
 * records older than 30 days. The Android app asks the device function for the same alerts (_shared/alerts.ts).
 * Auth: header x-cron-secret = CRON_SECRET.
 *   POST {dryRun: true, asOf?}            → what it would send, without sending (asOf pretends it's another time)
 *   POST {dryRun: true, summary: true}    → the summary as it would read now
 *   POST {fixture: true}                  → the rows the app reads (for tests on real data, kept outside the repo)
 *   POST {digest: {date, title, body}}    → sends a summary once for that date (kept for the old GitHub job)
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendOnce, sendToAll } from "../_shared/push.ts";
import { istHour, planAlerts } from "../_shared/alerts.ts";
import { readRows, runEngine } from "../_shared/engine.ts";
import { appActive } from "../_shared/devices.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const SECRET = Deno.env.get("CRON_SECRET") ?? "";

let NOW = () => Date.now();                                                 // a dry run may pretend it's another time

/** The 9 PM summary: the app's own engine on your data, in the app's words. Sent once a day, in the 21:00 run. */
async function summary(force = false) {
  if (!force && istHour(NOW()) !== 21) return null;
  const d = runEngine(await readRows(db, OWNER), NOW()).digest();
  return { key: `digest|${d.date}`, note: { title: d.title.slice(0, 120), body: d.body.slice(0, 400), url: "/#/today", tag: "digest" } };
}

/** Keeps the free plan's database small: sync records older than 30 days go, once a day (the 3 AM run). */
async function prune() {
  if (istHour(NOW()) !== 3) return null;
  const cutoff = new Date(NOW() - 30 * 86400000).toISOString();
  const { error, count } = await db.from("ingest_log").delete({ count: "exact" }).eq("user_id", OWNER).lt("received_at", cutoff);
  return error ? "prune failed: " + error.message : `pruned ${count ?? 0} sync records older than 30 days`;
}

/** The same reads the app makes (rust/app/src/api.rs), with the service role, for your rows only. */
async function fixture() {
  const reads: [string, string, string?][] = [
    ["transactions", "source_ref,occurred_at,amount,direction,description,counted,snippet,sheet_row,deleted_at,accounts(kind,aliases),categories(name)", "sheet_row"],
    ["card_emails", "message_id,received_at,kind,amount,minimum_due,due_date,statement_date,sender,sheet_row,deleted_at,accounts(last4,issuer)", "sheet_row"],
    ["card_payments", "source_ref,account_label,paid_on,amount,matched_by,sheet_row,deleted_at", "sheet_row"],
    ["goals", "id,name,target,start_amount,target_date,priority,deleted_at", "created_at"],
    ["goal_contributions", "id,goal_id,amount,on_date,deleted_at", "on_date"],
    ["rules", "pattern,deleted_at,categories(name)", "priority"],
    ["settings", "key,value"],
    ["payee_rules", "pattern,category"],
    ["txn_notes", "txn_ref,category,for_someone_else,paid_back,note"],
  ];
  const out: Record<string, unknown[]> = {};
  for (const [t, sel, order] of reads) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      let q = db.from(t).select(sel).eq("user_id", OWNER).range(from, from + 999);
      if (order) q = q.order(order, { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw new Error(t + ": " + error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[t] = rows;
  }
  const { data: log } = await db.from("ingest_log").select("received_at").eq("user_id", OWNER).eq("kind", "sync").eq("result", "saved")
    .order("received_at", { ascending: false }).limit(1);
  out.ingest_log = log ?? [];
  return out;
}

Deno.serve(async (req) => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (!OWNER || !SECRET) return reply(503, { error: "not configured" });
  if ((req.headers.get("x-cron-secret") ?? "") !== SECRET) return reply(401, { error: "no" });
  let body: { dryRun?: boolean; asOf?: string; summary?: boolean; testPush?: boolean; fixture?: boolean; digest?: { date: string; title: string; body: string } } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const asOf = body.dryRun && body.asOf ? Date.parse(body.asOf) : NaN;
  NOW = isNaN(asOf) ? () => Date.now() : () => asOf;
  try {
    if (body.fixture) return reply(200, await fixture());
    if (body.digest) {
      const d = body.digest;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || "") || !d.title) return reply(400, { error: "digest needs date and title" });
      return reply(200, await sendOnce(db, OWNER, `digest|${d.date}`, { title: String(d.title).slice(0, 120), body: String(d.body || "").slice(0, 400), url: "/#/today", tag: "digest" }));
    }
    if (body.testPush) return reply(200, await sendToAll(db, OWNER, { title: "Test from Money", body: "If you can read this, alerts work.", tag: "test" }));
    if (body.dryRun && body.summary) return reply(200, { dryRun: true, summary: await summary(true) });
    const { due, why } = await planAlerts(db, OWNER, NOW());
    const s = await summary().catch((e) => { why.push("summary failed: " + (e instanceof Error ? e.message : e)); return null; });
    if (s) due.push(s);
    if (body.dryRun) return reply(200, { dryRun: true, due, why });
    const pruned = await prune();
    if (pruned) why.push(pruned);
    const sent = [];
    const opts = (await appActive(db, OWNER).catch(() => false)) ? { skipDeviceNames: ["Android phone"] } : {};
    for (const d of due) sent.push({ key: d.key, ...(await sendOnce(db, OWNER, d.key, d.note, opts)) });
    return reply(200, { ok: true, sent, why });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
