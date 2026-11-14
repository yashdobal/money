// Money RN, clicked through in its web preview (rn/dist-web) over the demo data: adding a payment saves it and shows
// it, editing a category writes the note, setting a balance changes where you stand, hiding amounts hides them, the
// planner and the sign-in steps work. Usage: node tools/ui/rn.click.test.mjs
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import url from "url";
import { TODAY, CHROMIUM, fixture, fakeSupabase } from "./fake.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "rn/dist-web");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [], errors = [];
let n = 0, cur = null;
const step = async (name, fn) => { n++; try { await fn(); console.log("ok   " + name); } catch (e) { if (cur && process.env.SHOTS) await cur.screenshot({ path: process.env.SHOTS + "/fail-" + n + ".png" }).catch(() => {});
    if (cur) { const x = cur.getByLabel("Close", { exact: true }).last(); if (await x.count().catch(() => 0)) await x.click({ timeout: 2000 }).catch(() => {}); await cur.waitForTimeout(500); } fails.push(name + ": " + String(e.message || e).split("\n")[0]); console.log("FAIL " + name + "\n     " + String(e.message || e).split("\n")[0]); } };
const must = (c, msg) => { if (!c) throw new Error(msg); };

async function open(opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1000 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(fakeSupabase(fixture, opts.noSession));
  // the "Get alerts?" offer is its own test: everywhere else it has already been answered
  if (!opts.offer) await ctx.addInitScript(() => { try { localStorage.setItem("ls:pref-alertsOffered", "1"); } catch (e) {} });
  const saves = [];
  await ctx.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "rn.test") {
      let f = path.join(DIST, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
      if (!fs.existsSync(f)) f = path.join(DIST, "index.html");
      return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".ttf") ? "font/ttf" : undefined });
    }
    if (u.hostname.endsWith("supabase.co")) {
      try { saves.push(JSON.parse(r.request().postData() || "{}")); } catch (e) {}
      return r.fulfill({ body: JSON.stringify({ ok: true, version: 4 }), contentType: "application/json" });
    }
    return r.abort();
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  await p.clock.install({ time: TODAY });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("https://rn.test/");
  await p.waitForTimeout(2500);
  cur = p;
  return { ctx, p, saves };
}
const text = (p) => p.evaluate(() => document.body.innerText);
const tab = async (p, name) => { await p.getByRole("tab", { name }).filter({ visible: true }).first().click(); await p.waitForTimeout(700); };
const tapText = async (p, t) => { await p.getByText(t, { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(600); };
const fill = async (p, label, v) => { const f = p.getByLabel(label, { exact: true }).filter({ visible: true }).last(); await f.click(); await f.fill(v); await p.waitForTimeout(200); };

const { ctx, p, saves } = await open();
await step("Today shows Safe to spend until payday with the figure", async () => {
  const t = await text(p);
  must(/Safe to spend until payday/.test(t), "no hero label");
  // the big figure rolls digit by digit, so it's read from its label
  must(await p.getByLabel("₹10,080", { exact: true }).count() > 0, "hero figure isn't ₹10,080");
  must(/Needs attention/.test(t) && /Coming up/.test(t) && /Bank balance/.test(t), "a Today panel is missing");
});
await step("Add a payment: saved to your account and shown in Activity", async () => {
  await tab(p, "Activity");
  await p.getByLabel("Add a payment").filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  await fill(p, "Amount (₹)", "250");
  await fill(p, "What for", "Test lunch");
  await tapText(p, "Add payment"); await p.waitForTimeout(1500);
  must(/Added ₹250/.test(await text(p)), "no 'Added ₹250' message");
  must(saves.some((s) => s.action === "save" && (s.settings.manual || []).some((m) => m.t === "Test lunch")), "no save with the payment");
  must(/Test lunch/.test(await text(p)), "not in Activity");
});
await step("Search finds it; a filter chip narrows the list", async () => {
  await p.getByPlaceholder("Search payee, category, amount or note").filter({ visible: true }).first().fill("lunch"); await p.waitForTimeout(800);
  const t = await text(p);
  must(/Test lunch/.test(t) && !/Swiggy/.test(t), "search didn't narrow");
  await p.getByPlaceholder("Search payee, category, amount or note").filter({ visible: true }).first().fill(""); await p.waitForTimeout(600);
  await tapText(p, "Money in");
  must(!/Test lunch/.test(await text(p)), "Money in still shows a payment");
  await tapText(p, "All");
});
await step("Edit a transaction's category: the note is written", async () => {
  const w0 = await p.evaluate(() => window.__writes.length);
  await p.getByText("Swiggy", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  must(/Category/.test(await text(p)), "no category in the sheet");
  await tapText(p, "Groceries");
  await tapText(p, "Save"); await p.waitForTimeout(1200);
  const w = await p.evaluate(() => window.__writes);
  must(w.length > w0 && w.slice(w0).some((x) => x.table === "txn_notes" && x.op === "upsert" && x.row.category === "Groceries"), "no txn_notes write: " + JSON.stringify(w.slice(w0)));
});
await step("Set the Heron Bank balance: where you stand goes up by it", async () => {
  await tab(p, "Today");
  await p.waitForTimeout(1500);           // Today stayed mounted: its figures count to the new values
  const before = await text(p);
  const was = Number(((before.match(/Where you stand\s*\n?\s*([−-]?₹[\d,]+)/) || [])[1] || "").replace(/[₹,]/g, "").replace("−", "-"));
  await p.getByText("Update", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  await fill(p, "Balance in the Heron app (₹)", "5000");
  await tapText(p, "Set balance"); await p.waitForTimeout(1800);
  const after = await text(p);
  const now = Number(((after.match(/Where you stand\s*\n?\s*([−-]?₹[\d,]+)/) || [])[1] || "").replace(/[₹,]/g, "").replace("−", "-"));
  must(isFinite(was) && isFinite(now) && Math.round(now - was) === 5000, "where you stand " + was + " → " + now);
  must(saves.some((s) => s.action === "save" && s.settings.hob === 5000), "no save with hob 5000");
});
await step("Hide amounts: no amount is drawn on any screen, only the mask", async () => {
  await p.getByLabel("Hide amounts").filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  // the digits must not be on the page at all (not see-through, not blurred: Android drew those in black), and nothing
  // a screen reader would say may hold them either
  for (const tab of ["Today", "Plan", "Cards", "Spending", "Activity", "Trips", "Rewards"]) {
    await p.getByRole("tab", { name: tab }).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
    const shown = await p.evaluate(() => {
      const seen = (e) => e.getBoundingClientRect().width > 0;
      const texts = [...document.querySelectorAll("div,span,input")].filter(seen).flatMap((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).concat(e.value || []));
      const said = [...document.querySelectorAll("[aria-label]")].filter(seen).map((e) => e.getAttribute("aria-label"));
      return texts.concat(said).filter((t) => /₹\s?\d/.test(t));
    });
    must(!shown.length, tab + ": amounts still showing: " + shown.slice(0, 5).join(" | "));
    if (tab === "Today") must((await text(p)).includes("₹ ••••"), "Today doesn't show the mask");
  }
  await p.getByRole("tab", { name: "Today" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  await p.getByLabel("Show amounts").filter({ visible: true }).first().click(); await p.waitForTimeout(600);
});
await step("Plan: the salary planner, calendar, goals and EMIs; next month's plan", async () => {
  await tab(p, "Plan");
  const t = await text(p);
  must(/Salary planner/.test(t) && /Split it/.test(t) && /Yours to spend/.test(t) && /Calendar/.test(t) && /Goals/.test(t) && /EMIs/.test(t), "a Plan part is missing");
  await p.getByText(/^This month/).filter({ visible: true }).first().click(); await p.waitForTimeout(700);
  must(/Your 30 Nov salary|Your \d+ Nov salary/.test(await text(p)), "this month's salary didn't show");
});
await step("Plan: the calendar is five weeks of seven days, each Monday to Sunday on one line", async () => {
  const days = await p.evaluate(() => [...document.querySelectorAll("[aria-label]")].filter((e) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w+/.test(e.getAttribute("aria-label")) && e.getBoundingClientRect().width > 0)
    .map((e) => { const r = e.getBoundingClientRect(); return { l: e.getAttribute("aria-label").slice(0, 3), x: Math.round(r.left), y: Math.round(r.top), w: r.width }; }));
  must(days.length === 35, "the calendar shows " + days.length + " days, not 35");
  for (let w = 0; w < 5; w++) {
    const row = days.slice(w * 7, w * 7 + 7);
    must(row.map((d) => d.l).join(" ") === "Mon Tue Wed Thu Fri Sat Sun", "week " + (w + 1) + " isn't Monday to Sunday: " + row.map((d) => d.l).join(" "));
    must(row.every((d) => d.y === row[0].y), "week " + (w + 1) + " isn't on one line");
    must(row.every((d, i) => !i || d.x > row[i - 1].x), "week " + (w + 1) + " isn't left to right");
    must(row.every((d) => Math.abs(d.x - days[row.indexOf(d)].x) <= 1), "week " + (w + 1) + " doesn't line up under the first");
  }
  must(days[7].y > days[0].y, "the second week isn't under the first");
});
await step("Add a goal (the date from the calendar)", async () => {
  await p.getByText("Add a goal", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  await fill(p, "What for", "Bike");
  await fill(p, "Target (₹)", "60000");
  await p.getByText("Add goal", { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(800);
  must(/Pick a date in the future/.test(await text(p)), "no date asked for");
  await p.getByLabel("By", { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(600);
  await p.getByLabel("Next month").click(); await p.waitForTimeout(300);
  await p.getByText("15", { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(500);
  must(/15 Jan 2027/.test(await text(p)), "date not picked");
  await p.getByText("Add goal", { exact: true }).filter({ visible: true }).last().click(); await p.waitForTimeout(1200);
  must(/Goal added/.test(await text(p)) && /Bike/.test(await text(p)), "goal not shown");
  must(saves.some((s) => s.action === "save" && (s.settings.goals || []).some((g) => g.name === "Bike" && g.date === "2027-01-15")), "goal not saved");
});
await step("Cards and Spending draw; a category opens Activity filtered", async () => {
  await tab(p, "Cards");
  const ct = await text(p);
  must(/On the card/.test(ct), "no card faces");
  must(/To pay on|All paid/.test(ct) && /Best card to use today/.test(ct), "no summary or best-card panel");
  must(!/\bPayments\b[\s\S]*CRED confirmed/.test(ct), "payment history still on the page");
  await p.getByText("Payments", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  must(/Payments to /.test(await text(p)), "payment history sheet didn't open");
  await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
  await tab(p, "Spending");
  must(/Spent in/.test(await text(p)) && /Six months/.test(await text(p)), "spending incomplete");
  await p.getByText("Shopping", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  const t = await text(p);
  must(/Activity/.test(t) && /Shopping/.test(t), "category didn't open Activity");
});
await step("Rewards: a search finds the best card and the way to pay; the cards you could get; the month's figures", async () => {
  await tab(p, "Rewards");
  let t = await text(p);
  must(/What are you buying\?/.test(t) && /Points this month/.test(t) && /Your next card/.test(t) && /How it counts/.test(t), "the tab's panels are missing");
  const box = p.getByLabel("What are you buying?").filter({ visible: true }).first();
  await box.fill("iPhone on Amazon 80000"); await box.press("Enter"); await p.waitForTimeout(1200);
  t = await text(p);
  must(/Electronics · at Amazon · ₹80,000 · online/.test(t), "not understood: " + (t.match(/Understood as:\s*\n?([^\n]*)/) || [])[1]);
  must(/Best card · electronics\s*\n?\s*Lotus Shopper ·3333/.test(t) && /Pay at Amazon with this card/.test(t) && /₹4,000/.test(t) && /5% back on ₹80,000/.test(t), "the answer isn't Lotus Shopper at Amazon, ₹4,000");
  must(new URL(p.url()).hash.includes("q=iPhone"), "the search isn't in the address");
  // without Prime, Amazon pays 3%
  await p.getByRole("switch", { name: "I have Amazon Prime" }).filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  must(/₹2,400/.test(await text(p)) && saves.some((s) => s.action === "save" && s.settings.overrides && s.settings.overrides.rew && s.settings.overrides.rew.prime === false), "Prime off didn't change the answer or save");
  await p.getByRole("switch", { name: "I have Amazon Prime" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  // fuel: nothing earns
  await box.fill("petrol 3000"); await box.press("Enter"); await p.waitForTimeout(1200);
  must(/None of your cards earns on this/.test(await text(p)), "fuel shows a card that earns");
  // an example chip searches
  await p.getByLabel("Clear").filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  must(!new URL(p.url()).hash.includes("q="), "clearing didn't clear the search");
  await tapText(p, "Myntra 4,000");
  t = await text(p);
  must(/Clothes and beauty · at Myntra · ₹4,000/.test(t) && /If you had…/.test(t) && /Flipkart Axis/.test(t), "the Myntra example didn't search, or Flipkart Axis isn't offered");
});
await step("Trips: the trip, the airline, the points, the best cards, the cards you can get", async () => {
  await tab(p, "Trips");
  let t = await text(p);
  // the order on the page
  const at = ["Your trip", "Airline", "Points for this trip", "Best cards for Air India", "Cards you can get"].map((h) => t.indexOf(h));
  must(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), "the panels are missing or out of order: " + at.join());
  must(/Japan · 2 people · 7 nights · Economy/.test(t) && /1,20,000/.test(t), "not the default trip");
  must(/Air India\s*Preferred/.test(t) && /30,000 points each way/.test(t) && /42,000 miles each way · via Singapore/.test(t), "the airlines aren't shown");
  must(/Axis Magnus/.test(t) && /SBI Card Miles\s*Yours/.test(t), "the best cards or your own card are missing");
  must(t.indexOf("Axis Magnus") < t.indexOf("Axis Horizon") && t.indexOf("Axis Horizon") < t.indexOf("SBI Card AURUM"), "the cards aren't in conversion order");
  must(!/income a year/i.test(t) && !/₹11,83,200/.test(t), "the income is on the page");
  // the other airline: the points and the card list follow
  await tapText(p, "KrisFlyer");
  t = await text(p);
  must(/1,68,000/.test(t) && /Best cards for KrisFlyer/.test(t) && /don't move to KrisFlyer/.test(t), "picking KrisFlyer didn't change the plan");
  await tapText(p, "30,000 points each way");
  // business class to Japan: KrisFlyer only
  await p.getByRole("radio", { name: "Business" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  t = await text(p);
  must(/3,52,000/.test(t) && /Only KrisFlyer has a confirmed business price/.test(t), "business class to Japan isn't KrisFlyer only");
  await p.getByRole("radio", { name: "Economy" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  // the hotel: a dearer budget, then left out
  await p.getByRole("radio", { name: "Luxury" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  must(/Hotel, luxury/.test(await text(p)), "the hotel budget didn't change");
  await p.getByRole("switch", { name: "Pay for the hotel with points" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  t = await text(p);
  must(/you pay for the stay yourself\./.test(t) && !/Accor points/.test(t) && !/A room for a night/.test(t), "the hotel wasn't left out");
  await p.getByRole("switch", { name: "Pay for the hotel with points" }).filter({ visible: true }).first().click(); await p.waitForTimeout(600);
  // another country, one traveller
  await tapText(p, "Thailand");
  await p.getByLabel("Fewer travellers").filter({ visible: true }).first().click(); await p.waitForTimeout(500);
  t = await text(p);
  must(/Thailand · 1 person · 7 nights · Economy/.test(t) && /24,000/.test(t), "Thailand for one isn't 24,000 points");
  // the cards you can get follow the income, which is set in a sheet and never shown on the page
  const got = (s) => s.slice(s.indexOf("Cards you can get"), s.indexOf("Going by"));
  must(/Axis Horizon/.test(got(t)) && /HSBC TravelOne/.test(got(t)) && !/Axis Magnus/.test(got(t)) && !/per ₹100/.test(got(t)), "cards you can get: " + got(t));
  await tapText(p, "Change the income used");
  await fill(p, "Income a year (₹)", "400000"); await tapText(p, "Save"); await p.waitForTimeout(900);
  t = await text(p);
  must(!/Axis Horizon/.test(got(t)) && /SBI Card Miles Prime/.test(got(t)) && /Going by the income you set/.test(t), "a ₹4L income should leave only the SBI Miles cards");
  must(t.indexOf("Axis Magnus") > 0 && t.indexOf("Axis Magnus") < t.indexOf("Cards you can get"), "the best-cards list moved with the income");
  await tapText(p, "Change the income used"); await tapText(p, "Use my salary"); await p.waitForTimeout(700);
  // your month on a card
  await tapText(p, "Change the monthly spending");
  await fill(p, "Everyday spending a month (₹)", "80000"); await tapText(p, "Save"); await p.waitForTimeout(900);
  must(/₹80,000 a month of card spending \(the figures you typed\)/.test(await text(p)), "the spending you typed isn't used");
  // one of your cards: its sheet takes the points you hold
  await p.getByText(/SBI Card Miles(?!\s*(Prime|Elite))/).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  t = await text(p);
  must(/One of your cards\./.test(t) && /Conversion/.test(t) && /Flights · Air India/.test(t) && /add-on card/.test(t) && /Checked against/.test(t) && /Your points/.test(t), "your card's sheet is missing its parts");
  must(!/I have this card/.test(t), "a card the app already tracks shouldn't ask whether you have it");
  await fill(p, "Points on it now", "30000"); await tapText(p, "Save"); await p.waitForTimeout(1500);
  must(saves.some((s) => s.action === "save" && s.settings.overrides && s.settings.overrides.trip && s.settings.overrides.trip.pts && s.settings.overrides.trip.pts["sbi-miles"] === 30000), "the points weren't saved");
  // a card you don't have yet: mark it as yours
  await p.getByText("HSBC TravelOne", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  await p.getByRole("switch", { name: "I have this card" }).filter({ visible: true }).first().click(); await p.waitForTimeout(400);
  await fill(p, "Points on it now", "10000"); await tapText(p, "Save"); await p.waitForTimeout(1500);
  must(/HSBC TravelOne\s*Yours/.test(await text(p)), "the card isn't marked as yours");
  await tapText(p, "Where the numbers come from");
  must(/Flight prices in points/.test(await text(p)) && /Not confirmed/.test(await text(p)), "no sources");
  await p.getByLabel("Close").filter({ visible: true }).last().click(); await p.waitForTimeout(600);
  await tapText(p, "Start again"); await p.waitForTimeout(600);
  must(/Japan · 2 people · 7 nights · Economy/.test(await text(p)), "Start again didn't reset the trip");
});
await step("Settings: every group, and a colour choice is kept", async () => {
  await p.getByLabel("Settings").filter({ visible: true }).first().click(); await p.waitForTimeout(900);
  const t = await text(p);
  ["Security", "Appearance", "Alerts", "Your data", "Sync", "Account"].forEach((g) => must(t.includes(g), "no " + g));
  await p.getByLabel("Forest").click(); await p.waitForTimeout(600);
  must(await p.evaluate(() => localStorage.getItem("ls:pref-palette")) === "forest", "palette not kept");
});
await ctx.close();

const s2 = await open({ noSession: true });
await step("Signed out: email, then the 6-digit code step", async () => {
  must(/Your money, in one place/.test(await text(s2.p)), "no sign-in screen");
  await fill(s2.p, "Email", "demo@example.com");
  await s2.p.getByText("Email me a sign-in code", { exact: true }).click(); await s2.p.waitForTimeout(900);
  const t = await text(s2.p);
  must(/Check your email/.test(t) && /d•+@example\.com/.test(t), "no code step");
});
await s2.ctx.close();
await browser.close();

if (errors.length) fails.push("page errors: " + [...new Set(errors)].join(" | "));
console.log(fails.length ? "\n" + fails.length + " of " + n + " failed" : "\nall " + n + " steps passed");
process.exit(fails.length ? 1 : 0);
