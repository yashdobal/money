// The website (dist/, Money RN's code built by tools/build_site.py), opened as it is served, over the demo data:
// every screen opens and keeps moving, the address and Back follow you, a link opens its screen, the browser's
// 4-digit lock works, what the old website kept in the browser carries over, the "Get alerts?" offer, the wide
// layout on a laptop, and the page inside the Android app (a stand-in AndroidBridge). Usage: node tools/ui/site.test.mjs
import { chromium } from "playwright";
import { CHROMIUM, TODAY, openSite, text, tab, ORIGIN } from "./site.mjs";

const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
let n = 0;
const step = async (name, fn) => { n++; try { await fn(); console.log("ok   " + name); } catch (e) { fails.push(name + ": " + String(e.message || e).split("\n")[0]); console.log("FAIL " + name + "\n     " + String(e.message || e).split("\n")[0]); } };
const must = (c, msg) => { if (!c) throw new Error(msg); };
const running = (p) => p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
const TABS = ["Today", "Plan", "Cards", "Spending", "Activity", "Trips"];
// a browser that hasn't been asked about notifications yet (headless Chromium on some machines answers "denied")
const UNASKED = `try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (e) {}`;
const typeCode = async (p, code) => { for (const d of code) { await p.keyboard.press(d); await p.waitForTimeout(60); } await p.waitForTimeout(1200); };

// ---------------- a phone-sized browser ----------------
{
  const { ctx, p, errors } = await openSite(browser, {});
  await step("every screen opens and keeps moving", async () => {
    for (const t of TABS) {
      await tab(p, t); await p.waitForTimeout(500);
      const k = await running(p);
      must(k > 0, t + ": nothing moving");
    }
  });
  await step("the address follows the screen, and Back goes back", async () => {
    await tab(p, "Today"); await tab(p, "Cards");
    must(new URL(p.url()).hash.startsWith("#/cards"), "address is " + p.url());
    await p.getByRole("button", { name: "Settings" }).first().click(); await p.waitForTimeout(700);
    must(new URL(p.url()).hash.startsWith("#/settings"), "address is " + p.url());
    await p.goBack(); await p.waitForTimeout(800);
    must(new URL(p.url()).hash.startsWith("#/cards"), "after Back the address is " + p.url());
    must(new URL(p.url()).origin === ORIGIN, "left the site");
  });
  await step("no page errors", async () => must(!errors.length, errors.join(" | ")));
  await ctx.close();
}

await step("a link opens its screen", async () => {
  const { ctx, p, errors } = await openSite(browser, { at: "/#/plan" });
  must(new URL(p.url()).hash.startsWith("#/plan"), "address is " + p.url());
  const sel = await p.getByRole("tab", { name: "Plan" }).filter({ visible: true }).first().getAttribute("aria-selected");
  must(sel === "true", "Plan isn't the chosen tab");
  must(!errors.length, errors.join(" | "));
  await ctx.close();
});

await step("4-digit lock: set it, it asks after you've been away, a wrong code is refused, the right one opens", async () => {
  let { ctx, p } = await openSite(browser, {});
  await p.getByRole("button", { name: "Settings" }).first().click(); await p.waitForTimeout(700);
  await p.getByText("App lock code", { exact: true }).first().click(); await p.waitForTimeout(900);
  await typeCode(p, "2468"); await typeCode(p, "2468");
  must((await p.evaluate(() => localStorage.getItem("money-pin"))) !== null, "code not kept");
  must(!(await p.evaluate(() => localStorage.getItem("money-pin"))).includes("2468"), "the digits are kept as they are");
  // closed, and opened again an hour later
  await p.close();
  const q = await ctx.newPage();
  await q.clock.install({ time: new Date(TODAY).getTime() + 2 * 3600e3 });
  await q.goto(ORIGIN + "/"); await q.waitForTimeout(2500);
  p = q;
  must((await text(p)).includes("Money is locked"), "didn't lock");
  await typeCode(p, "1357");
  must(/Wrong code\. 4 tries left/.test(await text(p)), "wrong code not refused");
  await typeCode(p, "2468");
  must(!(await text(p)).includes("Money is locked"), "right code didn't open it");
  must((await text(p)).includes("Safe to spend"), "Today isn't showing");
  await ctx.close();
});

await step("what the old website kept carries over (dark theme, hidden amounts, the alerts answer)", async () => {
  const { ctx, p } = await openSite(browser, { offer: true, bridge: UNASKED, storage: { "money-theme": "dark", "money-hide": "1", "money-push-later": "1" } });
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  must(r + g + b < 120, "not dark: " + bg);
  must((await text(p)).includes("••••"), "amounts not hidden");
  must(!(await text(p)).includes("Get alerts in this browser?"), "asked about alerts again");
  await ctx.close();
});

await step("the \"Get alerts?\" offer shows once in a browser", async () => {
  const { ctx, p } = await openSite(browser, { offer: true, bridge: UNASKED });
  must((await text(p)).includes("Get alerts in this browser?"), "no offer");
  await p.getByRole("button", { name: "Later" }).click(); await p.waitForTimeout(600);
  await p.reload(); await p.waitForTimeout(2500);
  must(!(await text(p)).includes("Get alerts in this browser?"), "asked again");
  await ctx.close();
});

await step("a setup link shows what it holds, and saving it keeps your banks and cards in your account", async () => {
  const setup = { profile: { banks: [{ key: "teal", name: "Teal", full: "Teal Bank", match: "Teal" }],
    groups: { blue: { short: "Blue Card", issuer: "Blue", stmtDay: 12, dueAfter: 20 } }, cards: { "Blue Card XX7777": { group: "blue", last4: "7777" } } } };
  const b64 = Buffer.from(JSON.stringify(setup)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const { ctx, p, saves, errors } = await openSite(browser, { at: "/#/settings?sheet=setup:" + b64 });
  const t = await text(p);
  must(t.includes("Teal Bank") && t.includes("Blue Card") && t.includes("Save to my account"), "the setup isn't shown");
  await p.getByText("Save to my account", { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(1500);
  must(saves.some((x) => x.settings && x.settings.profile && x.settings.profile.groups && x.settings.profile.groups.blue), "the profile wasn't saved");
  must(!errors.length, errors.join(" | "));
  await ctx.close();
});

// ---------------- a laptop ----------------
{
  const { ctx, p, errors } = await openSite(browser, { width: 1280, height: 860, phone: false });
  await step("wide: a sidebar, two columns, nothing spills sideways", async () => {
    const side = await p.getByRole("tab", { name: "Plan" }).filter({ visible: true }).count();
    must(side > 0, "no sidebar");
    for (const t of ["Today", "Plan", "Spending"]) {
      await tab(p, t);
      const cols = await p.evaluate(() => [...document.querySelectorAll('[id^="cols-"]')].filter((e) => e.offsetParent && getComputedStyle(e).columnCount === "2").length);
      must(cols > 0, t + ": not two columns");
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      must(over <= 1, t + ": spills " + over + "px sideways");
    }
  });
  await step("wide: a sheet opens as a dialog in the middle", async () => {
    await tab(p, "Activity");
    await p.getByRole("button", { name: /^Add/ }).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
    const box = await p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 200).pop(); return d && { x: d.x, w: d.width }; });
    must(box, "no dialog");
    must(Math.abs(box.x + box.w / 2 - 640) < 160, "not in the middle: " + JSON.stringify(box));
    await p.keyboard.press("Escape").catch(() => {});
  });
  await step("wide: no page errors", async () => must(!errors.length, errors.join(" | ")));
  await ctx.close();
}

// ---------------- inside the Android app ----------------
const BRIDGE = `(() => {
  const kept = {}; window.__calls = []; window.__gets = [];
  const log = (f) => (...a) => { window.__calls.push([f, ...a]); };
  window.AndroidBridge = {
    version: () => "99", sessionGet: (k) => (k in kept ? kept[k] : localStorage.getItem(k)), sessionSet: (k, v) => { kept[k] = v; }, sessionDel: (k) => { delete kept[k]; },
    haptic: log("haptic"), setBars: log("setBars"), setBarColors: log("setBarColors"), systemColors: () => "null",
    lockInfo: () => JSON.stringify({ available: true, enabled: false, after: 0, hideRecents: false }), setLock: log("setLock"), setLockAfter: log("setLockAfter"),
    setHideRecents: log("setHideRecents"), openLockSettings: log("openLockSettings"),
    notifInfo: () => JSON.stringify({ permission: "granted", enabled: true }), testNotification: () => "shown", openNotificationSettings: log("openNotificationSettings"),
    openLinkSettings: log("openLinkSettings"), linksVerified: () => "yes", openEmailApp: log("openEmailApp"), shareFile: log("shareFile"),
    pushWidget: log("pushWidget"), clearWidget: log("clearWidget"), signedOut: log("signedOut"), hasDeviceKey: () => true, setDeviceKey: log("setDeviceKey"),
  };
})();`;
{
  const { ctx, p, errors } = await openSite(browser, { bridge: BRIDGE, wait: 3500 });
  const calls = () => p.evaluate(() => window.__calls.map((c) => c[0]));
  await step("Android app: the page tells the app its bar colours and fills the widget", async () => {
    await p.waitForTimeout(1200);
    const c = await calls();
    must(c.includes("setBars"), "no setBars");
    must(c.includes("pushWidget"), "no pushWidget");
    const w = await p.evaluate(() => window.__calls.find((c) => c[0] === "pushWidget")[1]);
    must(JSON.parse(w) && typeof JSON.parse(w) === "object", "widget data isn't JSON");
  });
  await step("Android app: Back and links go through window.UI", async () => {
    await p.evaluate(() => window.UI.open("#/trips")); await p.waitForTimeout(800);
    must(new URL(p.url()).hash.startsWith("#/trips"), "UI.open didn't open Trips: " + p.url());
    await p.evaluate(() => window.UI.back()); await p.waitForTimeout(800);
    must(!new URL(p.url()).hash.startsWith("#/trips"), "UI.back didn't go back");
  });
  await step("Android app: Settings shows the fingerprint lock, no code, no SMS row", async () => {
    await p.getByRole("button", { name: "Settings" }).first().click(); await p.waitForTimeout(900);
    const t = await text(p);
    must(!t.includes("App lock code"), "shows the browser's code");
    must(/fingerprint/i.test(t), "no fingerprint row");
    must(!/\bSMS\b/.test(t), "shows the SMS row");
    must(t.includes("Android app 99"), "version line doesn't say Android app");
  });
  await step("Android app: a tap buzzes through the app", async () => {
    await tab(p, "Plan");
    must((await calls()).includes("haptic"), "no haptic");
  });
  await step("Android app: no page errors", async () => must(!errors.length, errors.join(" | ")));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} of ${n} failed` : `\nall ${n} passed`);
process.exit(fails.length ? 1 : 0);
