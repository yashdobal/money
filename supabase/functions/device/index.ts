/**
 * device — what the Android app asks for in the background (every hour, and when you tap ↻ on the widget).
 *
 * The app can't use your sign-in for this: Supabase replaces the sign-in token each time it is refreshed, so a
 * background job refreshing it would sign the app out. Instead, once you're signed in, the app gets its own device key
 * from the app function (action "register-device"); only a hash of it is kept, in settings key "devices".
 *
 *   POST, header x-device-token: <key>
 *     {}                → {at, widget, alerts}
 *                          widget: the app's own Today numbers (app/engine.js widgetModel), worked out now
 *                          alerts: what's due now (bills, EMI, salary, quiet collector) and what was sent in the last
 *                                  26 hours (including the 9 PM summary), each with a key the phone shows once
 *     {want: "widget"}  → {at, widget}
 *     {action: "forget"}→ removes this device (signing out)
 *   401 if the key isn't known (the phone then clears its widget and waits for you to sign in again).
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { planAlerts } from "../_shared/alerts.ts";
import { readRows, runEngine } from "../_shared/engine.ts";
import { findDevice, forgetDevice, touchDevice } from "../_shared/devices.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";

type Alert = { key: string; title: string; body: string; url: string; channel: "normal" | "overdue"; at: number };
const urlFor = (key: string) => key.startsWith("bill") ? "/#/cards" : /^(emi|salary)\|/.test(key) ? "/#/plan" : "/#/today";
const channelFor = (key: string): Alert["channel"] => key.startsWith("bill-over") ? "overdue" : "normal";

Deno.serve(async (req) => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!OWNER) return reply(503, { error: "not configured" });
  const token = req.headers.get("x-device-token") ?? "";
  let body: { want?: string; action?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  try {
    const dev = await findDevice(db, OWNER, token);
    if (!dev) return reply(401, { error: "unknown device" });
    if (body.action === "forget") { await forgetDevice(db, OWNER, dev.id); return reply(200, { ok: true }); }
    await touchDevice(db, OWNER, dev.id);

    const now = Date.now();
    const [rows, plan, sent] = await Promise.all([
      readRows(db, OWNER),
      body.want === "widget" ? null : planAlerts(db, OWNER, now),
      body.want === "widget" ? null : db.from("notifications_log").select("key,title,body,sent_at").eq("user_id", OWNER)
        .gte("sent_at", new Date(now - 26 * 3600000).toISOString()).order("sent_at", { ascending: true }),
    ]);
    const widget = runEngine(rows, now).widget();
    if (body.want === "widget") return reply(200, { at: now, widget });

    const alerts = new Map<string, Alert>();
    for (const r of sent?.data ?? []) {
      alerts.set(r.key, { key: r.key, title: r.title, body: r.body, url: urlFor(r.key), channel: channelFor(r.key), at: Date.parse(r.sent_at) });
    }
    for (const p of plan?.due ?? []) {
      if (!alerts.has(p.key)) alerts.set(p.key, { key: p.key, title: p.note.title, body: p.note.body, url: p.note.url ?? urlFor(p.key), channel: channelFor(p.key), at: now });
    }
    return reply(200, { at: now, widget, alerts: [...alerts.values()] });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
