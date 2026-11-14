// Money RN in a browser (its web preview, rn/dist-web), over the demo data with a stand-in Supabase: every screen and
// sheet in light and dark, and any page error fails. The phone build is checked on GitHub; this checks the screens.
// Usage: node tools/ui/rn.shots.mjs [outDir]   (first: cd rn && npx expo export --platform web --output-dir dist-web)
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import url from "url";
import { TODAY, CHROMIUM, fixture, fakeSupabase } from "./fake.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "rn/dist-web");
const OUT = process.argv[2] || "/var/tmp/live/rn";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM });
const bad = [];
const H = Number(process.env.SHOT_H || 1600);

async function open(scheme, prefs) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme });
  await ctx.addInitScript(fakeSupabase(fixture));
  // the "Get alerts?" offer is its own test: everywhere else it has already been answered
  await ctx.addInitScript(() => { try { localStorage.setItem("ls:pref-alertsOffered", "1"); } catch (e) {} });
  await ctx.addInitScript((p) => { try { Object.entries(p || {}).forEach(([k, v]) => localStorage.setItem("ls:pref-" + k, v)); } catch (e) {} }, prefs || {});
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "rn.test") {
      let f = path.join(DIST, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
      if (!fs.existsSync(f)) f = path.join(DIST, "index.html");
      const type = f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".ttf") ? "font/ttf" : f.endsWith(".png") ? "image/png" : undefined;
      return r.fulfill({ body: fs.readFileSync(f), contentType: type });
    }
    if (u.hostname.endsWith("supabase.co")) return r.fulfill({ body: JSON.stringify({ ok: true, version: 4 }), contentType: "application/json" });
    return r.abort();
  });
  const p = await ctx.newPage();
  await p.clock.install({ time: TODAY });
  p.on("pageerror", (e) => bad.push(scheme + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) bad.push(scheme + " console: " + m.text().slice(0, 300)); });
  await p.goto("https://rn.test/");
  await p.waitForTimeout(2500);
  return { ctx, p };
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + ".png") });
const tab = async (p, name) => { await p.getByRole("tab", { name }).filter({ visible: true }).first().click(); await p.waitForTimeout(700); };
const tap = async (p, text, opts) => { const el = p.getByText(text, { exact: true, ...(opts || {}) }).filter({ visible: true }).last(); await el.click(); await p.waitForTimeout(700); };

for (const scheme of ["light", "dark"]) {
  const { ctx, p } = await open(scheme);
  await shot(p, scheme + "-today");
  for (const [tab_, name] of [["Plan", "plan"], ["Cards", "cards"], ["Spending", "spend"], ["Activity", "activity"], ["Trips", "trips"]]) {
    await tab(p, tab_); await p.waitForTimeout(600); await shot(p, scheme + "-" + name);
  }
  if (scheme === "light") {
    await tab(p, "Today");
    // sheets
    await p.getByLabel("How this is worked out").filter({ visible: true }).first().click(); await p.waitForTimeout(900); await shot(p, "sheet-explain");
    await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
    await tap(p, "Where you stand"); await p.waitForTimeout(500); await shot(p, "sheet-net");
    await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
    await tab(p, "Activity");
    await p.getByLabel("Add a payment").filter({ visible: true }).first().click(); await p.waitForTimeout(900); await shot(p, "sheet-add");
    await tap(p, "Money in"); await shot(p, "sheet-add-in");
    await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
    const first = p.getByText("Swiggy", { exact: true }).filter({ visible: true }).first();
    if (await first.count()) { await first.click(); await p.waitForTimeout(900); await shot(p, "sheet-tx"); await tap(p, "Groceries"); await shot(p, "sheet-tx-pick"); await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600); }
    await p.getByLabel("Settings").filter({ visible: true }).first().click(); await p.waitForTimeout(900); await shot(p, "settings");
    await tap(p, "Salary & fixed payments"); await p.waitForTimeout(900); await shot(p, "sheet-salary");
    await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
  } else {
    await p.getByLabel("Settings").filter({ visible: true }).first().click(); await p.waitForTimeout(900); await shot(p, "dark-settings");
  }
  await ctx.close();
}
// each colour theme, light, on Today
for (const pal of ["indigo", "forest", "ocean", "rose", "sand"]) {
  const { ctx, p } = await open("light", { palette: pal });
  await shot(p, "palette-" + pal);
  await ctx.close();
}
await browser.close();
console.log(bad.length ? "PROBLEMS:\n" + [...new Set(bad)].join("\n") : "rn shots ok → " + OUT);
process.exit(bad.length ? 1 : 0);
