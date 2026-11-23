// The card rulebooks the Rust engine reads, written out of the current engine (app/trips.js, app/rewards.js) as
// JSON: rust/core/data/cards.json. Regular expressions are written as their source (always case-insensitive).
// node tools/rust/data.mjs writes it; --check fails when it's out of date (the Rust check on GitHub runs that).
import fs from "fs";
import path from "path";
import url from "url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const { makeEngine } = await import(path.join(ROOT, "rn/src/engine.gen.js"));
const e = makeEngine({
  window: { MONEY: {}, UI: {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { hidden: true, addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: "" }) },
});
const src = (re) => (re ? re.source : null);
const out = {
  about: "Written by tools/rust/data.mjs from app/trips.js and app/rewards.js. Don't edit: change those and run it again.",
  trips: e.TRIP_DATA,
  tripRe: Object.fromEntries(Object.entries(e.TRIP_RE).map(([k, re]) => [k, src(re)])),
  tripLeftOut: e.TRIP_LEFT_OUT,
  rewards: e.REWARD_DATA,
  kinds: e.REW_KINDS.map((k) => ({ ...k, re: src(k.re) })),
  shops: e.REW_SHOPS.map((s) => ({ ...s, re: src(s.re) })),
  online: e.REW_ONLINE,
  leftOut: e.REW_LEFT_OUT,
};
const text = JSON.stringify(out, null, 1) + "\n";
const file = path.join(ROOT, "rust/core/data/cards.json");
if (process.argv.includes("--check")) {
  const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (have !== text) { console.error("rust/core/data/cards.json is out of date: run node tools/rust/data.mjs"); process.exit(1); }
  console.log("rust/core/data/cards.json is up to date");
} else { fs.writeFileSync(file, text); console.log("wrote rust/core/data/cards.json (" + text.length + " bytes)"); }
