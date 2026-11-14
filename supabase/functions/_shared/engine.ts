/**
 * The app's own engine on the server: reads your rows exactly as the app does (app/money-data.js), shapes them with
 * the same code (app/shape.js) and runs app/engine.js with local time set to India's. So the widget's numbers and the
 * 9 PM summary are the numbers the app shows. engine.gen.js is written by tools/build_app.py.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
// @ts-ignore: generated plain JavaScript
import { makeEngine } from "./engine.gen.js";
// @ts-ignore: plain JavaScript
import { istDate } from "./ist-date.js";

/** The same reads as getData() in app/money-data.js, for one user, with the service role. */
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

/** Runs the engine on the rows (as of now, or another moment for a dry run). */
export function runEngine(rows: Awaited<ReturnType<typeof readRows>>, nowMs?: number) {
  const E = makeEngine({ Date: istDate(nowMs === undefined ? undefined : () => nowMs) });
  const edits = rows.editRows ? E.shapeEdits(rows.editRows.rules, rows.editRows.notes) : { ok: false };
  E.ingest(E.shapeData({ ...rows, edits }));
  return { widget: (): Widget => E.widgetModel(), digest: (): Digest => E.digestModel() };
}
