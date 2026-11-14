// Pictures of the website (dist/): every screen on a phone and on a laptop, light and dark.
// Usage: node site.shots.mjs [outDir]     WIDTHS=390,1280 SCHEMES=light,dark VIEWS=Today,Plan
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { CHROMIUM, openSite, tab } from "./site.mjs";
const OUT = process.argv[2] || "/var/tmp/live/site";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const bad = [];
for (const width of (process.env.WIDTHS || "390,1280").split(",").map(Number)) for (const scheme of (process.env.SCHEMES || "light,dark").split(",")) {
  const { ctx, p, errors } = await openSite(browser, { width, height: width < 700 ? 844 : 800, scheme, scale: 1 });
  for (const v of (process.env.VIEWS || "Today,Plan,Cards,Spending,Activity,Trips,Rewards,Settings").split(",")) {
    if (v !== "Today") { if (v === "Settings" && width < 980) await p.getByLabel("Settings", { exact: true }).filter({ visible: true }).first().click(); else await tab(p, v); }
    await p.waitForTimeout(1600);
    // the whole screen, not just the window: grow the window to the screen's own scroll height
    const h = await p.evaluate(() => Math.max(...[...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== "visible" && d.getBoundingClientRect().width > 300).map((d) => d.scrollHeight), 0));
    const vp = p.viewportSize();
    if (h > vp.height) { await p.setViewportSize({ width, height: Math.min(h + 20, Number(process.env.SHOT_MAX) || 6000) }); await p.waitForTimeout(500); }
    await p.screenshot({ path: path.join(OUT, width + "-" + scheme + "-" + v.toLowerCase() + ".png"), timeout: 60000 });   // a tall page takes a while on a CI machine
    await p.setViewportSize(vp);
  }
  errors.forEach((e) => bad.push(width + " " + scheme + ": " + e));
  await ctx.close();
}
await browser.close();
if (bad.length) { console.error("PAGE ERRORS\n" + [...new Set(bad)].join("\n")); process.exit(1); }
console.log("site pictures in " + OUT);
