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
 *   POST {action: "rew-parse", text, kinds: [[id, name]], shops: [[id, name]], portals: [[id, name]]}
 *        The Rewards search: an AI model reads what you typed ("₹40k flight to Tokyo") as {kind, shop, amt, online,
 *        intl, not}, picking the kind and shop from the app's lists (not: the shops and portals you rule out, as in
 *        "non SmartBuy"). Uses Google's Gemini (free tier) when the GEMINI_API_KEY secret is set, else Anthropic's
 *        model with ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets); with neither it answers {ok: false} and
 *        the app keeps its own reading.
 *   POST {action: "rew-web", text, understood, cards: [{name, short, addOn}], app: {...}}
 *        The Rewards search's web check: searches the web for today's terms of your cards on this kind of spend
 *        (Tavily, TAVILY_API_KEY) and has Gemini (GEMINI_API_KEY) answer which of your cards is best, how much it
 *        earns, what to watch out for, and whether it agrees with the app's own sum, with the pages it used.
 *        Both have free plans. Without the keys: {ok: false, reason: "no-key"}.
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
/* Gemini (Google's free tier): one JSON reply. Tries the newest Flash, then the "latest" alias. */
const GEMINI_MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash,gemini-flash-latest").split(",").map((x) => x.trim()).filter(Boolean);
/* Gemini thinks before it answers, and the thinking counts towards maxOutputTokens: so a generous limit, and how hard
   to think ("low" for reading words, "medium" for the answer). A model that doesn't take thinkingConfig is asked again
   without it. */
async function gemini(system: string, user: string, maxTokens: number, think: "low" | "medium" = "low"): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { ok: false, reason: "no-key" };
  let last = "ai-error";
  for (const model of GEMINI_MODELS) {
    const ask = (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: maxTokens,
          ...(thinking ? { thinkingConfig: { thinkingLevel: think } } : {}) },
      }),
    });
    let r = await ask(true);
    if (r.status === 400) r = await ask(false);
    if (r.status === 404) { last = "no-model"; continue; }
    if (r.status === 429) return { ok: false, reason: "busy" };
    if (!r.ok) return { ok: false, reason: "ai-" + r.status };
    const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { ok: true, text };
  }
  return { ok: false, reason: last };
}
/** The first {...} in a model's reply, parsed; null if there isn't one. */
function jsonIn(out: string): Record<string, unknown> | null {
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function rewParse(body: Record<string, unknown>) {
  const text = String(body.text ?? "").slice(0, 300).trim();
  if (!text) return { ok: false, reason: "empty" };
  const kinds = pairs(body.kinds, 60), shops = pairs(body.shops, 150), portals = pairs(body.portals, 20);
  const system = "You read what an Indian credit-card user is about to spend money on, so an app can pick the card that earns most. " +
    "Reply with one JSON object and nothing else: {\"kind\": <kind id>, \"shop\": <shop id or null>, \"amt\": <rupees as a number, or null>, \"online\": <true|false>, \"intl\": <true|false>, \"not\": [<ids>]}.\n" +
    "kind: the id that best fits, from: " + kinds.map((k) => k[0] + " (" + k[1] + ")").join(", ") + ".\n" +
    "shop: the id of a shop the person names or clearly means and will pay at (\"Instamart order\" is instamart), from: " + shops.map((s) => s[0] + " (" + s[1] + ")").join(", ") + "; null when no listed shop is meant, and never a shop the person says they are NOT using.\n" +
    "not: the ids (shops above, or these booking portals: " + portals.map((s) => s[0] + " (" + s[1] + ")").join(", ") + ") the person rules out: \"non SmartBuy\", \"not on MakeMyTrip\", \"without Amazon Pay\"; booking direct with a hotel or airline, or on its own website, rules out every portal and travel site. [] when nothing is ruled out.\n" +
    "amt: only an amount the person states, in rupees (k = 1,000, lakh = 1,00,000); convert a foreign amount at about 95 rupees to the dollar and 105 to the euro; null if none.\n" +
    "online: false for a shop, restaurant or pump you walk into; true for an app or website.\n" +
    "intl: true only when it is paid in a foreign currency (shopping or eating abroad, a foreign website); flights and hotels abroad booked from India are paid in rupees, so false.";
  let out: string;
  const g = await gemini(system, text, 4096);
  if (g.ok) out = g.text;
  else {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return { ok: false, reason: g.reason };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 300, system, messages: [{ role: "user", content: text }] }),
    });
    if (!r.ok) return { ok: false, reason: "ai-" + r.status };
    const j = await r.json() as { content?: { type: string; text?: string }[] };
    out = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
  const spend = jsonIn(out);
  if (!spend) return { ok: false, reason: "no-json" };
  const not = Array.isArray(spend.not) ? spend.not.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  return { ok: true, spend: { kind: spend.kind, shop: spend.shop ?? null, amt: spend.amt ?? null, online: spend.online, intl: spend.intl, not } };
}

/* ---------------- the Rewards search's web check ---------------- */
type Hit = { title: string; url: string; content: string; date?: string };
async function tavily(query: string): Promise<Hit[]> {
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key) return [];
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 380), search_depth: "advanced", max_results: 6, chunks_per_source: 3, country: "india", include_answer: false }),
  });
  if (!r.ok) return [];
  const j = await r.json() as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
  return (j.results ?? []).filter((x) => x.url).map((x) => ({ title: String(x.title ?? x.url).slice(0, 160), url: String(x.url), content: String(x.content ?? "").slice(0, 1800), date: x.published_date ?? undefined }));
}
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

async function rewWeb(body: Record<string, unknown>) {
  if (!Deno.env.get("GEMINI_API_KEY") || !Deno.env.get("TAVILY_API_KEY")) return { ok: false, reason: "no-key" };
  const text = str(body.text, 300).trim();
  if (!text) return { ok: false, reason: "empty" };
  const understood = str(body.understood, 300);
  const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 12).map((c) => {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    return { name: str(o.name, 80), short: str(o.short, 60), addOn: o.addOn === true };
  }).filter((c) => c.name || c.short);
  if (!cards.length) return { ok: false, reason: "no-cards" };
  const app = JSON.stringify(body.app ?? null).slice(0, 2500);
  const today = new Date().toISOString().slice(0, 10);
  const cardList = cards.map((c) => (c.name || c.short) + (c.addOn ? " (add-on)" : "")).join("; ");

  // 1. what to search for: two short web searches about these cards and this spend
  const q = await gemini("You write web search queries for checking Indian credit card reward rules. Reply with JSON only: {\"queries\": [<at most 2 short queries>]}. " +
    "Name the cards and the exact kind of spend (and the booking channel when it matters, e.g. booked directly vs on a portal). Prefer queries that find the banks' own pages and recent reviews (e.g. CardExpert, CardInsider, TechnoFino, Reddit r/CreditCardsIndia).",
    `Today is ${today}. Spend: "${text}" (the app read it as: ${understood}). Cards: ${cardList}.`, 4096);
  let queries: string[] = [];
  if (q.ok) { const j = jsonIn(q.text); if (j && Array.isArray(j.queries)) queries = j.queries.filter((x): x is string => typeof x === "string").slice(0, 2); }
  if (!queries.length) queries = [cards.map((c) => c.name || c.short).join(" vs ") + " reward rate " + text];

  // 2. the web
  const hits = (await Promise.all(queries.map(tavily))).flat();
  const seen = new Set<string>(); const pages = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).slice(0, 10);
  if (!pages.length) return { ok: false, reason: "no-results", queries };

  // 3. the answer
  const system = "You are an expert on Indian credit card rewards. Decide which of the person's own cards earns most on one spend, " +
    "using the web pages given (they may be outdated or disagree: prefer the bank's own page and the most recent dates, and say when something is unclear). " +
    "Work it out the way the bank counts: the base rate, accelerated categories, portals such as HDFC SmartBuy only when the person books through them, monthly caps, " +
    "exclusions (rent, fuel, wallets, insurance, government), and minimum spends. Value points at their usual best redemption in rupees and say which. " +
    "An add-on card earns like the main card. Reply with JSON only:\n" +
    "{\"best\": {\"card\": <one of the person's cards, exactly as named>, \"how\": <how to pay, short>, \"earn\": <e.g. \"≈ 1,000 reward points\" or \"₹625 cashback\">, \"value\": <rupees, number>, \"rate\": <percent back, number>}, " +
    "\"others\": [{\"card\": <name>, \"earn\": <text>, \"value\": <number>, \"note\": <one short line>}], " +
    "\"agree\": <true if the app's pick is the same card, else false>, \"why\": <two or three plain sentences>, " +
    "\"watch\": [<at most 3 short warnings: caps, exclusions, changes coming>], \"used\": [<indexes of the pages you relied on>]}";
  const user = `Today is ${today}.\nSpend: "${text}"\nThe app read it as: ${understood}\nTheir cards: ${cardList}\nThe app's own sum (from rules it keeps): ${app}\n\nWeb pages:\n` +
    pages.map((p, i) => `[${i}] ${p.title} (${p.url})${p.date ? " · " + p.date : ""}\n${p.content}`).join("\n\n");
  const a = await gemini(system, user, 16384, "medium");
  if (!a.ok) return { ok: false, reason: a.reason };
  const j = jsonIn(a.text);
  if (!j || !j.best || typeof j.best !== "object") return { ok: false, reason: "no-json" };
  const b = j.best as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const used = Array.isArray(j.used) ? j.used.filter((i): i is number => typeof i === "number" && i >= 0 && i < pages.length) : [];
  const sources = (used.length ? used.map((i) => pages[i]) : pages.slice(0, 4)).map((p) => ({ title: p.title, url: p.url, date: p.date ?? null }));
  return {
    ok: true,
    best: { card: str(b.card, 80), how: str(b.how, 160), earn: str(b.earn, 80), value: num(b.value), rate: num(b.rate) },
    others: (Array.isArray(j.others) ? j.others : []).slice(0, 6).map((o) => { const x = (o ?? {}) as Record<string, unknown>; return { card: str(x.card, 80), earn: str(x.earn, 80), value: num(x.value), note: str(x.note, 200) }; }),
    agree: j.agree === true, why: str(j.why, 700),
    watch: (Array.isArray(j.watch) ? j.watch : []).slice(0, 3).map((w) => str(w, 220)),
    sources, queries,
  };
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
    if (body.action === "rew-web") return reply(200, await rewWeb(body));
    return reply(400, { error: "unknown action" });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
