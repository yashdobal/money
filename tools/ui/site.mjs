// The website as it is served (dist/, built by tools/build_site.py), opened in a test browser on the made-up demo
// data: a stand-in account (fake.mjs), a fixed clock, and nothing from the network. Shared by the site.* checks.
import fs from "fs";
import path from "path";
import { TODAY, CHROMIUM, ROOT, fixture, fakeSupabase } from "./fake.mjs";
export { TODAY, CHROMIUM, ROOT };
export const DIST = process.env.SITE_DIST || path.join(ROOT, "dist");
export const ORIGIN = "https://yash-money.pages.dev";
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".ttf": "font/ttf", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };

/** o: { width, height, scheme, noSession, bridge (a script that defines window.AndroidBridge), storage ({key: value}
    put in the browser's storage first), offer (leave the "Get alerts?" offer unanswered), phone } */
export async function openSite(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width || 390, height: o.height || 844 }, deviceScaleFactor: o.scale || 1, isMobile: o.phone !== false && (o.width || 390) < 700,
    hasTouch: o.phone !== false && (o.width || 390) < 700, colorScheme: o.scheme || "light", reducedMotion: o.still ? "reduce" : "no-preference", serviceWorkers: "block" });
  await ctx.addInitScript(fakeSupabase(fixture, o.noSession));
  const store = Object.assign(o.offer ? {} : { "ls:pref-alertsOffered": "1" }, o.storage || {});
  await ctx.addInitScript((kv) => { try { if (!sessionStorage.getItem("__seeded")) { Object.keys(kv).forEach((k) => localStorage.setItem(k, kv[k])); sessionStorage.setItem("__seeded", "1"); } } catch (e) {} }, store);
  if (o.bridge) await ctx.addInitScript(o.bridge);
  const saves = [], errors = [];
  await ctx.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === ORIGIN) {
      let f = path.join(DIST, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(f.endsWith("/") || (fs.existsSync(f) && fs.statSync(f).isDirectory()) ? f : DIST, "index.html");
      return r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || "application/octet-stream" });
    }
    if (u.hostname.endsWith("supabase.co")) {
      try { saves.push(JSON.parse(r.request().postData() || "{}")); } catch (e) {}
      return r.fulfill({ body: JSON.stringify({ ok: true, version: 4 }), contentType: "application/json" });
    }
    return r.abort();
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  if (!o.realClock) await p.clock.install({ time: TODAY });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(ORIGIN + (o.at || "/"));
  await p.waitForTimeout(o.wait || 2500);
  return { ctx, p, saves, errors };
}
export const text = (p) => p.evaluate(() => document.body.innerText);
export const tab = async (p, name) => { await p.getByRole("tab", { name }).filter({ visible: true }).first().click(); await p.waitForTimeout(700); };
