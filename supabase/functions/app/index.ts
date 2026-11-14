/**
 * app — what the signed-in app may change. Requires your Supabase login (verify_jwt = true) and your user id.
 *
 *   POST {action: "save", settings: {...}, baseVersion: n}
 *        Stores the dashboard's settings object exactly as it saves it (the same keys the Sheet's App data tab holds).
 *        baseVersion must match what the app last loaded, so a stale tab can't overwrite newer changes (409 if not).
 *   POST {action: "refresh"}
 *        Asks the collector to run now. The collector checks every minute and runs within about a minute.
 *   POST {action: "test-push"}
 *        Sends a test notification to every device you turned notifications on for.
 *   POST {action: "register-device", name}
 *        The Android app, once you're signed in: a device key for its background work (the device function).
 *        The phone's browser alerts are switched off at the same time, since the app now shows them (no doubles).
 *   POST {action: "rew-parse", text, kinds: [[id, name]], shops: [[id, name]]}
 *        The Rewards search: an AI model reads what you typed ("₹40k flight to Tokyo") as {kind, shop, amt, online,
 *        intl}, picking the kind and shop from the app's lists. Needs the ANTHROPIC_API_KEY secret (Supabase →
 *        Edge Functions → Secrets); without it this answers {ok: false} and the app keeps its own keyword reading.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendToAll } from "../_shared/push.ts";
import { registerDevice } from "../_shared/devices.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const ORIGINS = ["https://yash-money.pages.dev", "http://localhost:5173"];

// The keys the dashboard saves, and their types (mirrors STORE_KEYS in the collector).
const KEYS: Record<string, "num" | "bool" | "str" | "arr" | "obj"> = {
  ob: "num", obAt: "num", hob: "num", hobAt: "num", inc: "num", payDay: "num", payDayV: "num", buffer: "num", seeded: "bool", migrated: "str", joined: "str",
  manual: "arr", payments: "arr", goals: "arr", contribs: "arr", overrides: "obj", catRules: "obj", payAssign: "obj",
  cfg: "obj",          // salary & fixed payments (payslip figures, split, fixed payments)
  profile: "obj",      // your banks and cards (see applyProfile in app/engine.js)
};
const MAX_BYTES = 400_000;

function cors(origin: string | null) {
  const o = origin && (ORIGINS.includes(origin) || /^https:\/\/[a-z0-9]+\.yash-money\.pages\.dev$/.test(origin)) ? origin : ORIGINS[0];
  return { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
}

function clean(s: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, t] of Object.entries(KEYS)) {
    const v = s[k];
    if (t === "num") out[k] = typeof v === "number" && isFinite(v) ? v : null;
    else if (t === "bool") out[k] = v === true;
    else if (t === "str") out[k] = typeof v === "string" ? v.slice(0, 40) : "";
    else if (t === "arr") out[k] = Array.isArray(v) ? v.slice(-2000) : [];
    else out[k] = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }
  return out;
}

async function getSetting(key: string) {
  const { data, error } = await db.from("settings").select("value").eq("user_id", OWNER).eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}
async function putSetting(key: string, value: unknown) {
  const { error } = await db.from("settings").upsert({ user_id: OWNER, key, value, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  if (error) throw new Error(error.message);
}

/* ---------------- the Rewards search's AI step ---------------- */
const AI_MODEL = Deno.env.get("REWARDS_MODEL") ?? "claude-haiku-5-5";
const pairs = (v: unknown, n: number) => (Array.isArray(v) ? v : []).filter((x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string")
  .slice(0, n).map((x) => [String(x[0]).slice(0, 40), String(x[1]).slice(0, 60)]);
async function rewParse(body: Record<string, unknown>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { ok: false, reason: "no-key" };
  const text = String(body.text ?? "").slice(0, 300).trim();
  if (!text) return { ok: false, reason: "empty" };
  const kinds = pairs(body.kinds, 60), shops = pairs(body.shops, 150);
  const system = "You read what an Indian credit-card user is about to spend money on, so an app can pick the card that earns most. " +
    "Reply with one JSON object and nothing else: {\"kind\": <kind id>, \"shop\": <shop id or null>, \"amt\": <rupees as a number, or null>, \"online\": <true|false>, \"intl\": <true|false>}.\n" +
    "kind: the id that best fits, from: " + kinds.map((k) => k[0] + " (" + k[1] + ")").join(", ") + ".\n" +
    "shop: the id of a shop the person names or clearly means (\"Instamart order\" is instamart), from: " + shops.map((s) => s[0] + " (" + s[1] + ")").join(", ") + "; null when no listed shop is meant.\n" +
    "amt: only an amount the person states, in rupees (k = 1,000, lakh = 1,00,000); convert a foreign amount at about 95 rupees to the dollar and 105 to the euro; null if none.\n" +
    "online: false for a shop, restaurant or pump you walk into; true for an app or website.\n" +
    "intl: true only when it is paid in a foreign currency (shopping or eating abroad, a foreign website); flights and hotels abroad booked from India are paid in rupees, so false.";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 200, system, messages: [{ role: "user", content: text }] }),
  });
  if (!r.ok) return { ok: false, reason: "ai-" + r.status };
  const j = await r.json() as { content?: { type: string; text?: string }[] };
  const out = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "no-json" };
  let spend: Record<string, unknown>;
  try { spend = JSON.parse(m[0]); } catch { return { ok: false, reason: "bad-json" }; }
  return { ok: true, spend: { kind: spend.kind, shop: spend.shop ?? null, amt: spend.amt ?? null, online: spend.online, intl: spend.intl } };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...h, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!OWNER) return reply(503, { error: "not configured" });

  // who is calling: the JWT is checked by the platform; we still require it to be you
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: authErr } = await db.auth.getUser(token);
  if (authErr || who?.user?.id !== OWNER) return reply(403, { error: "not your account" });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply(413, { error: "too large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "not JSON" }); }

  try {
    if (body.action === "save") {
      const cur = (await getSetting("app.state")) as { version: number; data?: Record<string, unknown> } | null;
      const version = cur?.version ?? 0;
      if (typeof body.baseVersion === "number" && body.baseVersion !== version) {
        return reply(409, { error: "changed elsewhere", version });
      }
      const incoming = (body.settings ?? {}) as Record<string, unknown>;
      // an older copy of the app doesn't know about the profile: it keeps the one saved, rather than clearing it
      if (!("profile" in incoming) && cur?.data?.profile) incoming.profile = cur.data.profile;
      const next = { version: version + 1, savedAt: new Date().toISOString(), data: clean(incoming) };
      await putSetting("app.state", next);
      return reply(200, { ok: true, version: next.version, savedAt: next.savedAt });
    }
    if (body.action === "refresh") {
      const requestedAt = Date.now();
      await putSetting("refresh", { requestedAt, by: "app" });
      return reply(200, { ok: true, requestedAt });
    }
    if (body.action === "test-push") {
      const r = await sendToAll(db, OWNER, { title: "Notifications are on", body: "Money will tell you about bills, EMIs, your salary and a quiet collector.", tag: "test" });
      return reply(200, { ok: true, ...r });
    }
    if (body.action === "register-device") {
      const r = await registerDevice(db, OWNER, String(body.name ?? "Android app"));
      const { count } = await db.from("push_subscriptions").delete({ count: "exact" }).eq("user_id", OWNER).eq("device_name", "Android phone");
      return reply(200, { ok: true, token: r.token, browserAlertsOff: count ?? 0 });
    }
    if (body.action === "rew-parse") return reply(200, await rewParse(body));
    return reply(400, { error: "unknown action" });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
