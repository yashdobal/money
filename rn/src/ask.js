/* The Rewards search's AI step: the app function (action "rew-parse") asks an AI model what your words mean (the kind
   of spending, the shop, the amount, online or not, a foreign currency), so anything you type works. The keyword
   reading (E.rewParse) shows at once; this refines it when it answers. No answer (no AI key on the server, offline,
   the demo) leaves the keyword reading as it is. Answers are kept for the session, so a search is asked once. */
import { E, callApp } from "./store";

const cache = {};
export async function askAI(q) {
  if (process.env.EXPO_PUBLIC_MONEY_DEMO === "1") return null;
  const key = String(q || "").trim().toLowerCase();
  if (!key) return null;
  if (key in cache) return cache[key];
  let sp = null;
  try {
    const { status, out } = await callApp({ action: "rew-parse", text: String(q).slice(0, 300),
      kinds: E.REW_KINDS.map((k) => [k.id, k.name]), shops: E.REW_SHOPS.filter((s) => s.id !== "smartbuy").map((s) => [s.id, s.name]) });
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
  return Object.keys(out).length ? out : null;
}
