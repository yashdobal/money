/* The Rewards search's AI step: the app function (action "rew-parse") asks an AI model what your words mean (the kind
   of spending, the shop, the amount, online or not, a foreign currency), so anything you type works. The keyword
   reading (E.rewParse) shows at once; this refines it when it answers. No answer (no AI key on the server, offline,
   the demo) leaves the keyword reading as it is. Answers are kept for the session, so a search is asked once. */
import { E, callApp } from "./store";

/** The booking portals that aren't shops, by name (with SmartBuy): what "non SmartBuy" can rule out. */
export const PORTALS = [["smartbuy", "HDFC SmartBuy"], ["traveledge", "Axis Travel EDGE"], ["hsbcapp", "HSBC Travel with Points"], ["amazonpay", "Amazon Pay"]];
export const placeName = (id) => { const p = PORTALS.find((x) => x[0] === id); if (p) return p[1]; const s = E.REW_SHOPS.find((x) => x.id === id); return s ? s.name : id; };
/** "not on HDFC SmartBuy", or "booked direct" when every portal and travel site is ruled out. */
export function notText(not) {
  if (!not || !not.length) return null;
  if (E.REW_PORTALS.every((id) => not.includes(id))) return "booked direct (no portal or travel site)";
  return "not on " + not.map(placeName).join(" or ");
}

const cache = {};
export async function askAI(q) {
  if (process.env.EXPO_PUBLIC_MONEY_DEMO === "1") return null;
  const key = String(q || "").trim().toLowerCase();
  if (!key) return null;
  if (key in cache) return cache[key];
  let sp = null;
  try {
    const { status, out } = await callApp({ action: "rew-parse", text: String(q).slice(0, 300),
      kinds: E.REW_KINDS.map((k) => [k.id, k.name]), shops: E.REW_SHOPS.filter((s) => s.id !== "smartbuy").map((s) => [s.id, s.name]),
      portals: PORTALS });
    if (status === 200 && out && out.ok && out.spend) sp = clean(out.spend);
  } catch (e) { sp = null; }
  cache[key] = sp;
  return sp;
}
/** Only what the AI said and the app knows: a kind and shop from the lists, a positive amount, true/false flags. */
function clean(s) {
  const out = {};
  if (E.REW_KINDS.some((k) => k.id === s.kind)) out.kind = s.kind;
  if (s.shop === null || E.REW_SHOPS.some((x) => x.id === s.shop)) out.shop = s.shop;
  if (typeof s.amt === "number" && isFinite(s.amt) && s.amt > 0 && s.amt < 1e9) out.amt = Math.round(s.amt);
  if (typeof s.online === "boolean") out.online = s.online;
  if (typeof s.intl === "boolean") out.intl = s.intl;
  if (Array.isArray(s.not)) out.not = s.not.filter((x) => typeof x === "string" && (E.REW_SHOPS.some((y) => y.id === x) || PORTALS.some((p) => p[0] === x)));
  return Object.keys(out).length ? out : null;
}

/* The web check (action "rew-web"): the app function searches the web for today's terms of your cards on this spend
   (Tavily) and an AI reads them (Gemini), both on free plans. Answers are kept for the session. */
const webCache = {};
export async function askWeb(key, body) {
  if (process.env.EXPO_PUBLIC_MONEY_DEMO === "1") return { ok: false, why: "The demo doesn't search the web." };
  if (webCache[key]) return webCache[key];
  try {
    const { status, out } = await callApp(Object.assign({ action: "rew-web" }, body));
    if (status === 200 && out && out.ok) { webCache[key] = out; return out; }
    const r = out && out.reason;
    return { ok: false, why: r === "no-key" ? "The web check isn't switched on yet: it needs two free keys added to the app's server."
      : r === "busy" ? "Gemini's free plan is busy for a moment. Try again in a minute."
      : r === "no-results" ? "The web search found nothing on this. Try naming the card or the shop."
      : r === "no-cards" ? "Add your cards first (Settings → Your banks and cards)." : "The web check didn't work this time. Try again." };
  } catch (e) { return { ok: false, why: "Couldn't reach the app's server. Check your connection." }; }
}
