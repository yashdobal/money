/**
 * For the emulator screenshots in GitHub Actions only: makes a --demo build of the website run on
 * the made-up demo data (tools/demo/demo-fixture.json), offline, as if it were 8 Dec 2026, 7:30 PM in India.
 * The Android build uses it only with -Pmoney.demo=true, which the APK you install never has.
 *
 * Usage: node tools/demo/android_demo.mjs <build folder>   (tools/build_site.py --demo runs it: it writes
 *   <build folder>/demo.js, which index.html loads first)
 */
import fs from "fs";
import path from "path";
import { ROOT, fakeSupabase, fixture } from "../ui/fake.mjs";

const out = process.argv[2];
const target = path.join(out, "demo.js");
if (!fs.readFileSync(path.join(out, "index.html"), "utf8").includes('src="/demo.js"')) throw new Error("index.html doesn't load /demo.js: build with --demo");

// the server's India-time Date (supabase/functions/_shared/ist-date.js), so the figures don't depend on the
// emulator's time zone, with the clock starting at the demo's "today"
const ist = fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/ist-date.js"), "utf8").replace(/^export /gm, "");
const clock = `(function () {\n${ist}\n  var NOW = Date.parse("2026-12-08T19:30:00+05:30");\n` +
  `  window.Date = istDate(function () { return NOW + Math.round(performance.now()); });\n})();\n`;
fs.writeFileSync(target, "/* DEMO BUILD: made-up data, frozen clock (tools/demo/android_demo.mjs) */\n" + clock + fakeSupabase(fixture, false) + "\n" +
  // the "Get alerts?" offer counts as answered, so it doesn't cover the screens
  'try { localStorage.setItem("ls:pref-alertsOffered", "1"); } catch (e) {}\n');
console.log("demo data in " + target);
