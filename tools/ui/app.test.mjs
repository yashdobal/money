// The website (rust/dist, built by rust/build-web.sh) used like a person would, on the made-up demo data (?demo, as
// if it were 8 Dec 2026): every tab and the sheets behind them, adding a payment, searching, editing one, hiding
// amounts, the colour and theme choices, an address that opens a sheet, the phone's Back, and the laptop layout.
// Fails on anything the page reports as broken (a crash, an error in the console). Saves a picture of every screen.
//   node tools/ui/app.test.mjs [pictures folder]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import url from "url";
import assert from "assert";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "rust/dist");
const OUT = process.argv[2] || path.join(ROOT, "tools/ui/shots");
assert.ok(fs.existsSync(path.join(DIST, "index.html")), "build the website first: rust/build-web.sh");
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
// the pre-installed Chromium where a machine has one (CI uses Playwright's own)
const PW = "/opt/pw-browsers";
const CHROMIUM = process.env.CHROMIUM || (fs.existsSync(PW) ? fs.readdirSync(PW).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .flatMap((d) => ["chrome-linux64", "chrome-linux"].map((sub) => path.join(PW, d, sub, "chrome"))).find((f) => fs.existsSync(f)) : undefined);
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
async function page(opts) {
  // no service worker: it would fetch from the real site, past the stand-in below
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block" });
  // the site from rust/dist, at its real address; nothing else is reachable (the demo never asks the server)
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== "yash-money.pages.dev") return r.abort();
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    return r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || "application/octet-stream" });
  });
  ctx.setDefaultTimeout(15000);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  p.errors = errors;
  return p;
}
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + ".png") });
const healthy = async (p, where) => {
  if (await p.locator("#crash").count()) assert.fail(where + ": the page crashed: " + (await p.locator("#crash").textContent()));
  assert.deepStrictEqual(p.errors, [], where + ": errors in the page");
};
const TABS = ["Today", "Plan", "Cards", "Spending", "Activity", "Trips", "Rewards"];
const tab = (p, name) => p.locator("nav.dock").getByLabel(name, { exact: true }).click();
const sheet = (p) => p.locator(".sheet");
const closeSheet = async (p) => { await p.locator(".sheet-x").click(); await p.waitForTimeout(350); };
const open = async (p, q) => { await p.goto("https://yash-money.pages.dev/" + (q || "?demo&at=2026-12-08")); await p.locator("nav.dock").waitFor({ timeout: 30000 }); await p.waitForTimeout(800); };

/* ---------------- a phone ---------------- */
const phone = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await open(phone);

await ok("every tab opens and draws", async () => {
  for (const t of TABS) {
    await tab(phone, t); await phone.waitForTimeout(700);
    assert.strictEqual((await phone.locator(".title").first().textContent()).trim(), t, "the title says " + t);
    assert.ok((await phone.locator(".page").first().innerText()).trim().length > 40, t + " shows something");
    await shot(phone, "phone-light-" + t.toLowerCase());
    await healthy(phone, t);
  }
  await phone.getByLabel("Settings", { exact: true }).first().click(); await phone.waitForTimeout(700);
  assert.strictEqual((await phone.locator(".title").first().textContent()).trim(), "Settings");
  await shot(phone, "phone-light-settings");
  await healthy(phone, "Settings");
});

await ok("Today: Safe to spend, and how it's worked out", async () => {
  await tab(phone, "Today"); await phone.waitForTimeout(500);
  await phone.locator(".hero").first().waitFor();
  const how = phone.getByText("How this is worked out", { exact: false }).first();
  if (await how.count()) { await how.click(); await sheet(phone).waitFor(); await shot(phone, "phone-light-explain"); await closeSheet(phone); }
  await healthy(phone, "Today");
});

await ok("add a payment, find it by searching, edit it", async () => {
  await tab(phone, "Activity"); await phone.waitForTimeout(500);
  await phone.locator(".fab").click(); await sheet(phone).waitFor();
  await phone.locator(".sheet input").first().fill("432");
  await phone.locator(".sheet input").nth(1).fill("Test lunch");
  await shot(phone, "phone-light-add");
  await phone.locator(".sheet .actions .btn").click(); await phone.waitForTimeout(500);
  assert.strictEqual(await sheet(phone).count(), 0, "the sheet closes");
  assert.match(await phone.locator(".toast").first().textContent(), /Added ₹432/);
  await phone.locator(".search input").fill("Test lunch"); await phone.waitForTimeout(400);
  const row = phone.locator(".page .rows").getByText("Test lunch").first();
  await row.waitFor();
  await row.click(); await sheet(phone).waitFor();
  await shot(phone, "phone-light-transaction");
  await phone.locator(".sheet .chip").filter({ hasText: "Groceries" }).first().click();
  await phone.locator(".sheet .actions .btn").last().click(); await phone.waitForTimeout(500);
  assert.match(await phone.locator(".page").first().innerText(), /Groceries/, "the new category shows");
  await phone.locator(".search input").fill("");
  await healthy(phone, "Activity");
});

await ok("hide amounts, then show them again", async () => {
  await tab(phone, "Today"); await phone.waitForTimeout(400);
  await phone.getByLabel("Hide amounts").click(); await phone.waitForTimeout(400);
  assert.ok(!/₹\s?\d/.test(await phone.locator(".hero").first().innerText()), "no amounts on Safe to spend");
  await shot(phone, "phone-light-hidden");
  await phone.getByLabel("Show amounts").click(); await phone.waitForTimeout(300);
  assert.ok(/₹/.test(await phone.locator(".hero").first().innerText()));
});

await ok("the sheets behind Plan, Cards, Trips and Rewards open and close", async () => {
  for (const [t, name, pick] of [["Plan", "goal", (p) => p.locator(".addrow").filter({ hasText: "Add a goal" })],
    ["Plan", "salary", (p) => p.locator("button").filter({ hasText: "Salary settings" })],
    ["Cards", "payments", (p) => p.locator("button").filter({ hasText: /^Payments$/ })],
    ["Trips", "sources", (p) => p.locator("button").filter({ hasText: "Where the numbers come from" })],
    ["Trips", "card", (p) => p.locator(".page button.row").filter({ hasNotText: /each way/ })],
    ["Rewards", "card", (p) => p.locator(".page .rows .press, .page .rows button")]]) {
    await tab(phone, t); await phone.waitForTimeout(500);
    const b = pick(phone).first();
    await b.scrollIntoViewIfNeeded(); await b.click();
    await sheet(phone).waitFor().catch(async (e) => { await shot(phone, "fail-" + t + "-" + name); throw new Error(t + " " + name + ": no sheet opened (" + (await b.textContent()) + ")"); });
    assert.ok((await sheet(phone).innerText()).trim().length > 20, t + " " + name + ": the sheet shows something");
    await shot(phone, "phone-light-" + t.toLowerCase() + "-" + name);
    await closeSheet(phone);
    assert.strictEqual(await sheet(phone).count(), 0, "closed");
    await healthy(phone, t + " " + name);
  }
});

await ok("Rewards: a search answers", async () => {
  await tab(phone, "Rewards"); await phone.waitForTimeout(500);
  const box = phone.locator(".page input").first();
  await box.fill("a new iPhone for 80k"); await box.press("Enter"); await phone.waitForTimeout(900);
  assert.match(await phone.locator(".page").first().innerText(), /Amazon/i, "the best way mentions Amazon");
  await shot(phone, "phone-light-rewards-search");
  await healthy(phone, "Rewards search");
});

await ok("Settings: colours and the dark theme", async () => {
  await phone.getByLabel("Settings", { exact: true }).first().click(); await phone.waitForTimeout(500);
  const accent = () => phone.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  const before = await accent();
  await phone.locator(".pal-list .chip").filter({ hasText: "Forest" }).click(); await phone.waitForTimeout(300);
  assert.notStrictEqual(await accent(), before, "Forest changes the accent");
  await phone.locator(".seg-o").filter({ hasText: "Dark" }).first().click(); await phone.waitForTimeout(400);
  assert.ok(await phone.evaluate(() => document.documentElement.classList.contains("dk")), "dark");
  await shot(phone, "phone-dark-settings-forest");
  await tab(phone, "Today"); await phone.waitForTimeout(500); await shot(phone, "phone-dark-today-forest");
  // back to Signal, and the dark theme for every tab's picture
  await phone.getByLabel("Settings", { exact: true }).first().click(); await phone.waitForTimeout(400);
  await phone.locator(".pal-list .chip").filter({ hasText: "Signal" }).click(); await phone.waitForTimeout(300);
  assert.strictEqual(await accent(), "#7F97FF", "Signal's dark accent");
  for (const t of TABS) { await tab(phone, t); await phone.waitForTimeout(600); await shot(phone, "phone-dark-" + t.toLowerCase()); }
  await phone.getByLabel("Settings", { exact: true }).first().click(); await phone.waitForTimeout(400);
  await phone.locator(".seg-o").filter({ hasText: "Light" }).first().click(); await phone.waitForTimeout(300);
  assert.ok(!(await phone.evaluate(() => document.documentElement.classList.contains("dk"))));
  await healthy(phone, "Settings");
});

await ok("an address opens a place: the widget's + and an alert's Cards", async () => {
  await open(phone, "?demo&at=2026-12-08#/today?sheet=add");
  await sheet(phone).waitFor();
  assert.match(await sheet(phone).innerText(), /Add a payment/);
  assert.ok(!(await phone.evaluate(() => location.hash)), "the address goes back to plain");
  // the Android app's back button: the sheet first, then Today, then it lets the app go
  assert.strictEqual(await phone.evaluate(() => window.UI.back()), true); await phone.waitForTimeout(300);
  assert.strictEqual(await sheet(phone).count(), 0);
  await phone.evaluate(() => window.UI.open("#/cards")); await phone.waitForTimeout(500);
  assert.strictEqual((await phone.locator(".title").first().textContent()).trim(), "Cards");
  assert.strictEqual(await phone.evaluate(() => window.UI.back()), true); await phone.waitForTimeout(300);
  assert.strictEqual((await phone.locator(".title").first().textContent()).trim(), "Today");
  assert.strictEqual(await phone.evaluate(() => window.UI.back()), false, "on Today, Back leaves the app");
  await healthy(phone, "addresses");
});

/* ---------------- inside the Android app (a stand-in bridge) ---------------- */
await ok("inside the Android app: the phone's bars, its settings rows, and a payment from a bank SMS", async () => {
  const app = await page({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await app.addInitScript(() => {
    const calls = (window.__calls = []);
    const rec = (n, v) => (...a) => { calls.push([n, ...a]); return typeof v === "function" ? v(...a) : v; };
    window.AndroidBridge = { version: rec("version", "1.0.999"), haptic: rec("haptic"), setBars: rec("setBars"), setBarColors: rec("setBarColors"), systemColors: rec("systemColors", "{}"),
      lockInfo: rec("lockInfo", JSON.stringify({ available: true, enabled: false, after: 60, hideRecents: false })), notifInfo: rec("notifInfo", JSON.stringify({ permission: "granted", enabled: true, muted: false })),
      pushWidget: rec("pushWidget"), clearWidget: rec("clearWidget"), hasDeviceKey: rec("hasDeviceKey", true), smsState: rec("smsState", "granted"), sessionGet: rec("sessionGet", null),
      readSms: rec("readSms", "[]") };
    // bank SMS on, with one made-up payment read before (8 Dec, 1 pm) that no bank email matches
    localStorage.setItem("money-rs-sms-on", "1");
    localStorage.setItem("money-rs-sms", JSON.stringify({ last: 0, hidden: [], items: [{ id: "sms-1796630400000-64900", ts: 1796630400000, amt: 649, dir: "out",
      desc: "CHAI POINT", account: "HDFC Bank ··1234", acct_key: null, alias: null, kind: "bank", body: "Sent Rs.649.00 From HDFC Bank A/C *1234 To CHAI POINT On 08/12/26" }] }));
  });
  await open(app);
  await app.waitForTimeout(1200);
  const calls = await app.evaluate(() => window.__calls);
  const w = calls.filter((c) => c[0] === "pushWidget");
  assert.strictEqual(w.length, 0, "the demo never sends the widget numbers");
  assert.ok(calls.some((c) => c[0] === "setBars"), "the phone's bars follow the theme");
  await app.getByLabel("Settings", { exact: true }).first().click(); await app.waitForTimeout(500);
  const text = await app.locator(".page").first().innerText();
  assert.match(text, /Fingerprint lock/); assert.match(text, /Read bank SMS/); assert.match(text, /System/, "the phone's own colours are a choice");
  assert.match(text, /Count them straight away/, "SMS is on");
  await shot(app, "app-settings");
  // the SMS payment waits in Activity; it can be added with its figures filled in, or hidden
  await app.locator("nav.dock").getByLabel("Activity", { exact: true }).click(); await app.waitForTimeout(500);
  const act = await app.locator(".page").first().innerText();
  assert.match(act, /From your SMS · waiting for the bank.s email[\s\S]*Chai Point/, act.slice(0, 300));
  await shot(app, "app-activity-sms");
  await app.locator(".page .rows").getByText("Chai Point").first().click(); await sheet(app).waitFor();
  assert.match(await sheet(app).innerText(), /From a bank SMS[\s\S]*Not mine/);
  await shot(app, "app-sms-sheet");
  await sheet(app).getByText("Add it now").click(); await app.waitForTimeout(300);
  assert.strictEqual(await app.locator(".sheet input").first().inputValue(), "649", "the amount comes filled in");
  await closeSheet(app);
  await app.locator(".page .rows").getByText("Chai Point").first().click(); await sheet(app).waitFor();
  await sheet(app).getByText("Not mine").click(); await app.waitForTimeout(400);
  assert.ok(!/Chai Point/.test(await app.locator(".page").first().innerText()), "hidden");
  await healthy(app, "inside the app");
  await app.context().close();
});

/* ---------------- a laptop ---------------- */
await ok("a laptop: the sidebar and wide screens", async () => {
  const lap = await page({ viewport: { width: 1366, height: 860 } });
  await open(lap);
  for (const t of TABS) {
    await lap.locator("nav.dock").getByLabel(t, { exact: true }).click(); await lap.waitForTimeout(600);
    await shot(lap, "laptop-" + t.toLowerCase());
  }
  await healthy(lap, "laptop");
  await lap.context().close();
});

await healthy(phone, "the end");
await browser.close();
console.log("\nall " + n + " passed · pictures in " + OUT);
