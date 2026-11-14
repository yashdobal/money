/**
 * ingest — the collector posts the Sheet here every hour; this keeps Supabase in step with it.
 *
 * While both systems run (Phases 1–4) the Sheet is the source of truth: every sync upserts all rows,
 * and when the payload says it is complete, rows that vanished from the Sheet are soft-deleted here.
 *
 * Auth: no Supabase JWT (deployed with verify_jwt = false). Each request carries
 *   x-money-time:      milliseconds since epoch when it was sent (must be within 5 minutes)
 *   x-money-signature: hex HMAC-SHA256 of `${time}.${body}` with INGEST_SECRET
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { mapSheet, type SyncPayload } from "./map.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SECRET = Deno.env.get("INGEST_SECRET")!;
const OWNER = Deno.env.get("OWNER_USER_ID")!;
const SHEET_ID = Deno.env.get("SHEET_ID") ?? "";   // only this spreadsheet may sync
const MAX_SKEW_MS = 5 * 60 * 1000;

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string) {               // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function upsert(table: string, rows: Record<string, unknown>[] | undefined, onConflict = "id") {
  if (!rows?.length) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

async function log(result: string, detail: string, tookMs: number) {
  await db.from("ingest_log").insert({ user_id: OWNER, kind: "sync", result, took_ms: tookMs, detail: detail.slice(0, 2000) });
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!SECRET || !OWNER) return reply(503, { error: "not configured: set INGEST_SECRET and OWNER_USER_ID" });
  const body = await req.text();
  const time = req.headers.get("x-money-time") ?? "";
  const sig = (req.headers.get("x-money-signature") ?? "").toLowerCase();
  if (!/^\d{13}$/.test(time) || Math.abs(Date.now() - Number(time)) > MAX_SKEW_MS) return reply(401, { error: "stale or missing time" });
  if (!sameText(sig, await hmacHex(`${time}.${body}`))) return reply(401, { error: "bad signature" });

  let payload: SyncPayload;
  try { payload = JSON.parse(body); } catch { return reply(400, { error: "body is not JSON" }); }
  if (SHEET_ID && payload.sheetId !== SHEET_ID) {
    await log("failed", `refused a sync from another spreadsheet (${payload.sheetId ?? "no id"})`, Date.now() - t0).catch(() => {});
    return reply(403, { error: "this isn't the Money sheet the app syncs from" });
  }

  // the collector checks every minute whether the app asked for a run (no public door into Apps Script)
  if ((payload as { kind?: string }).kind === "poll") {
    const { data } = await db.from("settings").select("value").eq("user_id", OWNER).eq("key", "refresh").maybeSingle();
    const r = (data?.value ?? {}) as { requestedAt?: number; handledAt?: number };
    const due = !!r.requestedAt && (!r.handledAt || r.requestedAt > r.handledAt) && Date.now() - r.requestedAt < 10 * 60 * 1000;
    if (due) await db.from("settings").upsert({ user_id: OWNER, key: "refresh", value: { ...r, handledAt: Date.now() } }, { onConflict: "user_id,key" });
    return reply(200, { ok: true, refresh: due });
  }

  // From Phase 3 the app owns your settings, planner, payments, goals and rules ("app.state").
  // The Sheet's App data tab is then ignored here, and the app's copy goes back to the collector to write into it.
  const { data: stateRow } = await db.from("settings").select("value").eq("user_id", OWNER).eq("key", "app.state").maybeSingle();
  const appState = stateRow?.value as { version: number; data: Record<string, unknown> } | undefined;
  if (appState?.data && payload.tabs) {
    payload.tabs.appData = [["key", "json"], ...Object.entries(appState.data).map(([k, v]) => [k, JSON.stringify(v)])];
  }

  try {
    const { tables: t, notes, keep, waiting } = await mapSheet(payload, OWNER);
    if (waiting) {                                    // no banks and cards saved in the app yet: nothing to file them under
      await log("ignored", notes.join(" · "), Date.now() - t0);
      return reply(200, { ok: true, waiting: true, notes, appData: appState?.data ?? null, appVersion: appState?.version ?? null });
    }
    const counts: Record<string, number> = {};
    // order follows the foreign keys
    for (const name of ["card_groups", "accounts", "categories", "goals", "transactions"]) counts[name] = await upsert(name, t[name]);
    for (const name of ["card_statements", "card_emails", "card_payments", "rules", "goal_contributions"]) {
      counts[name] = await upsert(name, t[name]);
    }

    let retired: Record<string, number> = {};
    if (payload.complete) {
      const { data, error } = await db.rpc("sync_retire", { p_user: OWNER, p_tx: keep.transactions, p_emails: keep.card_emails,
        p_payments: keep.card_payments, p_rules: keep.rules, p_goals: keep.goals });
      if (error) throw new Error(`retire: ${error.message}`);
      retired = data as Record<string, number>;
    }
    const took = Date.now() - t0;
    const detail = [payload.run?.message ?? "sync", `rows ${JSON.stringify(counts)}`,
      Object.values(retired).some(Boolean) ? `retired ${JSON.stringify(retired)}` : "", ...notes].filter(Boolean).join(" · ");
    await log("saved", detail, took);
    return reply(200, { ok: true, counts, retired, notes, took_ms: took,
      appData: appState?.data ?? null, appVersion: appState?.version ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("failed", msg, Date.now() - t0).catch(() => {});
    return reply(500, { ok: false, error: msg });
  }
});
