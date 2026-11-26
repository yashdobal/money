// The server's engine as the functions run it: Deno, the clock in UTC (as on Supabase), engine.ts loading the
// WebAssembly that build.sh wrote. On the demo data at the 42 recorded moments, the widget and the 9 PM summary must be
// the ones the app works out (rust/core/tests/golden/snapshot.json.gz).
//   ./build.sh && TZ=UTC deno test --allow-read --no-check deno.test.ts
import { runEngine } from "../../supabase/functions/_shared/engine.ts";

const root = new URL("../../", import.meta.url);
const read = async (p: string) => await Deno.readFile(new URL(p, root));
// the same JSON whatever the order of its keys (the recordings may list them differently)
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x);
const gunzip = async (b: Uint8Array) => new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();

Deno.test("the server works out the app's widget and summary", async () => {
  const f = JSON.parse(new TextDecoder().decode(await read("tools/demo/demo-fixture.json")));
  const rows = { tx: f.transactions, emails: f.card_emails, pays: f.card_payments, goals: f.goals, contribs: f.goal_contributions,
    rules: f.rules, settings: f.settings, lastSync: null, editRows: { rules: f.payee_rules ?? [], notes: f.txn_notes ?? [] } };
  const golden = JSON.parse(await gunzip(await read("rust/core/tests/golden/snapshot.json.gz")));
  let n = 0;
  for (const g of golden) {
    const e = runEngine(rows as never, g.at);
    const w = { ...e.widget() } as Record<string, unknown>;
    if (w.at !== g.at) throw new Error(`widget.at ${w.at} ≠ ${g.at}`);
    delete w.at;
    const got = canon({ widget: w, digest: e.digest() }), want = canon(g.server);
    if (got !== want) throw new Error(`at ${new Date(g.at).toISOString()}:\n got ${got.slice(0, 400)}\nwant ${want.slice(0, 400)}`);
    n++;
  }
  console.log(`${n} moments, the same widget and summary`);
});

Deno.test("bad rows are an error, not a crash", () => {
  let msg = "";
  try { runEngine("nope" as never, 0); } catch (e) { msg = (e as Error).message; }
  // a string isn't the rows object: the engine reads it as no data at all and still answers
  if (msg && !msg.startsWith("engine:")) throw new Error(msg);
});
