/**
 * The app's own engine on the server: reads your rows exactly as the app does (rust/app/src/api.rs) and works them out
 * with the same Rust code (rust/core, compiled for the server by rust/server/build.sh into ./money/). So the widget's
 * numbers and the 9 PM summary are the numbers the app shows. Times are India's whatever the server's clock zone.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
// @ts-ignore: generated plain JavaScript (rust/server/build.sh)
import { initSync, run } from "./money/money_server.js";
// @ts-ignore: generated plain JavaScript (rust/server/build.sh)
import { WASM } from "./money/wasm.js";

/** The same reads as the app's (rust/app/src/api.rs), for one user, with the service role. */
export async function readRows(db: SupabaseClient, owner: string) {
  const all = async (table: string, select: string, order?: string) => {
    const out: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      let q = db.from(table).select(select).eq("user_id", owner).range(from, from + 999);
      if (order) q = q.order(order, { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw new Error(table + ": " + error.message);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return out;
    }
  };
  const [tx, emails, pays, goals, contribs, rules, settings, log, payeeRules, notes] = await Promise.all([
    all("transactions", "source_ref,occurred_at,amount,direction,description,counted,snippet,sheet_row,deleted_at,accounts(kind,aliases),categories(name)", "sheet_row"),
    all("card_emails", "message_id,received_at,kind,amount,minimum_due,due_date,statement_date,sender,sheet_row,deleted_at,accounts(last4,issuer)", "sheet_row"),
    all("card_payments", "source_ref,account_label,paid_on,amount,matched_by,sheet_row,deleted_at", "sheet_row"),
    all("goals", "id,name,target,start_amount,target_date,priority,deleted_at", "created_at"),
    all("goal_contributions", "id,goal_id,amount,on_date,deleted_at", "on_date"),
    all("rules", "pattern,deleted_at,categories(name)", "priority"),
    all("settings", "key,value"),
    db.from("ingest_log").select("received_at").eq("user_id", owner).eq("kind", "sync").eq("result", "saved")
      .order("received_at", { ascending: false }).limit(1),
    db.from("payee_rules").select("pattern,category").eq("user_id", owner),
    db.from("txn_notes").select("txn_ref,category,for_someone_else,paid_back,note").eq("user_id", owner),
  ]);
  return { tx, emails, pays, goals, contribs, rules, settings,
    lastSync: log.data?.[0]?.received_at ?? null,
    editRows: payeeRules.error || notes.error ? null : { rules: payeeRules.data, notes: notes.data } };
}

export type Widget = Record<string, unknown> & { v: number; at: number; state: string };
export type Digest = { date: string; title: string; body: string };

let ready = false;
function start() {
  if (ready) return;
  const bin = atob(WASM as string), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  initSync({ module: bytes });
  ready = true;
}

/** Runs the engine on the rows (as of now, or another moment for a dry run). */
export function runEngine(rows: Awaited<ReturnType<typeof readRows>>, nowMs?: number) {
  start();
  let out: { widget: Widget; digest: Digest; error?: string };
  try {
    out = JSON.parse(run(JSON.stringify(rows), nowMs ?? Date.now()));
  } catch (e) {
    ready = false; // a crash inside the WebAssembly leaves it unusable: start afresh next time
    throw new Error("engine: " + ((e as Error)?.message ?? e));
  }
  if (out.error) throw new Error("engine: " + out.error);
  return { widget: (): Widget => out.widget, digest: (): Digest => out.digest };
}
