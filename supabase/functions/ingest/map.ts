/**
 * Sheet → tables, run on every sync.
 *
 * Pure functions only (no Deno or npm imports), so the same file runs in the Edge Function and in Node tests.
 * Ids are UUIDv5 of stable names (an account's last 4 digits, an email's message id …), so a row keeps its id across syncs.
 * Amounts are whole paise.
 */

export type Cell = string | number | boolean | null;
export type Tab = Cell[][];
export interface SyncPayload {
  sentAt: string;                // ISO time the collector sent this
  sheetId?: string;              // the spreadsheet it came from
  complete: boolean;             // true = these tabs are the whole Sheet, so missing rows were deleted
  tabs: { transactions: Tab; cardEvents: Tab; appData: Tab; plan: Tab };
  run?: { message?: string; tookMs?: number };
}
type Row = Record<string, unknown>;
export interface Mapped { tables: Record<string, Row[]>; notes: string[]; keep: Record<string, string[]>; waiting?: boolean }

// ---------------------------------------------------------------- ids
const NS = "6f1c2a52-6d6f-6e65-7970-6c616e300000";
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function uuid5(name: string): Promise<string> {
  const ns = new Uint8Array(NS.replace(/-/g, "").match(/../g)!.map((h) => parseInt(h, 16)));
  const nb = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nb.length);
  data.set(ns); data.set(nb, ns.length);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = hex(h);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
const uid = (...parts: unknown[]) => uuid5(parts.map(String).join("|"));

// ---------------------------------------------------------------- values
export function paise(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/[,₹\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not an amount: ${v}`);
  const [w, f = ""] = s.replace("-", "").split(".");
  // round half up on the third decimal, done on digits so 1354.05 never becomes 135404
  let p = Number(w) * 100 + Number((f + "00").slice(0, 2));
  if (Number((f + "000")[2]) >= 5) p += 1;
  return s.startsWith("-") ? -p : p;
}

const IST_MS = 330 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date-time cell → ISO instant. Accepts the collector's ISO strings and "31 May 2026, 05:13" (IST). */
export function when(v: Cell): string {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toISOString();
  const m = s.match(/^(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`not a date-time: ${s}`);
  const ms = Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1], +m[4], +m[5]) - IST_MS;
  return new Date(ms).toISOString();
}

/** A date cell → "YYYY-MM-DD" (IST). Accepts ISO instants, "2026-10-31", "2026-11", sheet serials. */
export function day(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim().replace(/^"|"$/g, "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(new Date(s).getTime() + IST_MS).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return s + "-01";
  throw new Error(`not a date: ${s}`);
}
const istMonth = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 7);

const FOOTER = /\s+Feel free to connect with us[\s\S]*$/;
export const clean = (t: Cell) => String(t ?? "").replace(FOOTER, "").trim();

function table(tab: Tab) {
  const [hdr = [], ...rest] = tab;
  const col: Record<string, number> = {};
  hdr.forEach((h, i) => (col[String(h)] = i));
  return { col, rows: rest.filter((r) => r[0] !== null && r[0] !== "") };
}

function json(v: Cell): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

// ---------------------------------------------------------------- your accounts
/** Your banks and cards, from the profile the app saves with your settings (see apply_profile in rust/core/src/engine). */
type Profile = { groups?: Record<string, { short?: string; issuer?: string; stmtDay?: number; dueAfter?: number; closed?: string }>;
  cards?: Record<string, { group?: string; last4?: string }> };
const last4Of = (label: string) => (label.match(/(\d{4})\s*$/) ?? [])[1] ?? null;

// ---------------------------------------------------------------- the mapping
export async function mapSheet(p: SyncPayload, user: string, asof = new Date()): Promise<Mapped> {
  const out: Record<string, Row[]> = {};
  const notes: string[] = [];
  const put = (t: string, r: Row) => (out[t] ??= []).push({ user_id: user, ...r });

  // App data
  const app: Record<string, unknown> = {};
  for (const [k, v] of table(p.tabs.appData).rows) if (k) app[String(k)] = json(v);

  // accounts: each card in your profile, and every other account the Sheet names (a bank account), by its last 4 digits
  const profile = (app.profile ?? null) as Profile | null;
  if (!profile || !profile.groups || !Object.keys(profile.groups).length) {
    return { tables: {}, notes: ["waiting for your banks and cards: add them in the app (Settings → Your banks and cards)"], keep: {}, waiting: true };
  }
  const groups = profile.groups, cards = profile.cards ?? {};
  for (const [g, d] of Object.entries(groups)) {
    if (!d || !(Number(d.stmtDay) >= 1)) continue;
    put("card_groups", { id: await uid("group", g), name: String(d.short ?? g), issuer: String(d.issuer ?? ""),
      statement_day: Number(d.stmtDay), due_days_after: Number(d.dueAfter) || null, closed_on: d.closed || null });
  }
  const acct: Record<string, string> = {}, made = new Set<string>();
  const addAccount = async (label: string, kind: string, group: string | null, extra: string[] = []) => {
    const l4 = last4Of(label), id = await uid("account", l4 ?? label);
    acct[label.toLowerCase()] = id;
    if (l4) acct[l4] = id;
    if (made.has(id)) return id;
    made.add(id);
    const g = group ? groups[group] : null;
    put("accounts", { id, kind, issuer: g ? String(g.issuer ?? "") : label.split(/\s+/)[0], name: label.replace(/\s*XX\d{4}\s*$/i, "").trim() || label,
      last4: l4, card_group_id: group ? await uid("group", group) : null, is_addon: !!(g && /add-on/i.test(String(g.short ?? ""))), aliases: [label, ...extra] });
    return id;
  };
  for (const [label, c] of Object.entries(cards)) {
    if (!c || !c.group || !groups[c.group]) continue;
    const first = !(c.group.toLowerCase() in acct);    // a payment you saved names the account, not one card: its first card
    const id = await addAccount(label, "card", c.group, first ? [c.group] : []);
    if (first) acct[c.group.toLowerCase()] = id;
  }
  const accountOf = async (label: Cell) => {
    const k = String(label ?? "").trim();
    const id = acct[k.toLowerCase()] ?? (last4Of(k) ? acct[last4Of(k)!] : undefined);
    if (id) return id;
    if (!k) throw new Error("a row with no account");
    return await addAccount(k, "bank", null);
  };

  // transactions
  const { col, rows } = table(p.tabs.transactions);
  const cats = new Map<string, boolean[]>();
  for (const r of rows) {
    const c = String(r[col["Category"]] || "Other");
    cats.set(c, [...(cats.get(c) ?? []), r[col["Counted as spending"]] === "Yes"]);
  }
  const rules = (app.catRules ?? {}) as Record<string, string>;
  for (const c of Object.values(rules)) if (!cats.has(c)) cats.set(c, [true]);
  let sort = 0;
  for (const [c, flags] of [...cats.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    put("categories", { id: await uid("category", c), name: c,
      counted_by_default: flags.filter(Boolean).length * 2 >= flags.length, sort: sort++ });
  }
  const txIds: string[] = [];
  for (const [rowIndex, r] of rows.entries()) {
    const mid = String(r[col["Message ID"]]).trim();
    const at = when(r[col["Date"]]);
    const desc = clean(r[col["Description"]]);
    const tid = await uid("txn", mid);
    txIds.push(mid);
    put("transactions", {
      id: tid, account_id: await accountOf(r[col["Account"]]), occurred_at: at, amount: paise(r[col["Amount"]]),
      direction: r[col["Direction"]], description: desc, category_id: await uid("category", r[col["Category"]] || "Other"),
      counted: r[col["Counted as spending"]] === "Yes", status: new Date(at) > asof ? "scheduled" : "posted",
      source: mid.startsWith("manual-") ? "manual" : "email", source_ref: mid,
      snippet: clean(r[col["Raw info"]]).slice(0, 240) || null, emi_instalment_id: null, deleted_at: null, sheet_row: rowIndex + 2,
    });
    const month = r[col["Month"]];
    const mm = month === null || month === "" ? null : /T/.test(String(month)) ? istMonth(String(month)) : String(month).slice(0, 7);
    if (mm && mm !== istMonth(at)) notes.push(`${mid}: Month column says ${mm}, the date says ${istMonth(at)}`);
  }

  // goals
  const goalId: Record<string, string> = {};
  const goalIds: string[] = [];
  for (const g of (app.goals ?? []) as Row[]) {
    const id = await uid("goal", g.id);
    goalId[String(g.name).toLowerCase()] = id;
    goalIds.push(id);
    put("goals", { id, name: String(g.name), target: paise(g.target as Cell),
      start_amount: paise((g.start ?? 0) as Cell), target_date: day((g.date ?? null) as Cell), priority: g.prio ?? null, deleted_at: null });
  }
  for (const c of (app.contribs ?? []) as Row[]) {
    put("goal_contributions", { id: await uid("contrib", c.id), goal_id: await uid("goal", c.goal), amount: paise(c.amt as Cell),
      on_date: day(c.date as Cell), source: "manual" });
  }

  // card emails → bills
  const ce = table(p.tabs.cardEvents);
  const groupOfLast4: Record<string, string> = {};
  for (const [label, c] of Object.entries(cards)) if (c && c.group && groups[c.group]) groupOfLast4[String(c.last4 ?? last4Of(label) ?? "")] = c.group;
  const stmts: { g: string; sd: string; es: Row[] }[] = [];
  const emailIds: string[] = [];
  const emails: Row[] = [];
  for (const [rowIndex, r] of ce.rows.entries()) {
    const c = ce.col, card = String(r[c["Card"]]).padStart(4, "0"), kind = r[c["Type"]], sd = day(r[c["Statement date"]]);
    let sid: string | null = null;
    if (kind === "statement") {
      const g = groupOfLast4[card];
      if (!g) { notes.push(`statement for a card that isn't in your profile: ${card}`); continue; }
      let s = stmts.find((x) => x.g === g && Math.abs(Date.parse(x.sd) - Date.parse(sd!)) <= 2 * 86400000);
      if (!s) stmts.push((s = { g, sd: sd!, es: [] }));
      s.es.push({ src: r[c["Source"]], sd, due: day(r[c["Due date"]]), amt: paise(r[c["Amount"]]), mind: paise(r[c["Minimum due"]]) });
      sid = await uid("statement", g, s.sd);
    }
    const mid = String(r[c["Message ID"]]);
    emailIds.push(mid);
    emails.push({ user_id: user, id: await uid("card-email", mid), message_id: mid, received_at: when(r[c["Email date"]]),
      account_id: acct[card] ?? null, kind, sender: r[c["Source"]], amount: paise(r[c["Amount"]]), minimum_due: paise(r[c["Minimum due"]]),
      due_date: day(r[c["Due date"]]), statement_date: sd, statement_id: sid, deleted_at: null, sheet_row: rowIndex + 2 });
  }
  const ov = (app.overrides ?? {}) as Record<string, unknown>;
  for (const s of stmts) {
    const best = s.es.find((e) => e.src !== "CRED") ?? s.es[0];
    if (new Set(s.es.map((e) => e.amt)).size > 1) notes.push(`${s.g} bill ${best.sd}: emails disagree on the amount`);
    put("card_statements", { id: await uid("statement", s.g, s.sd), card_group_id: await uid("group", s.g),
      statement_date: best.sd, due_date: best.due, billed: best.amt, minimum_due: best.mind,
      billed_override: typeof ov[`${s.g}|${best.sd}`] === "number" ? paise(ov[`${s.g}|${best.sd}`] as number) : null });
  }
  out["card_emails"] = emails;

  // card payments you entered by hand
  const payIds: string[] = [];
  for (const [i, x] of ((app.payments ?? []) as Row[]).entries()) {
    const id = await uid("payment", x.id);
    payIds.push(id);
    put("card_payments", { id, account_id: await accountOf(x.card as Cell), paid_on: day(x.date as Cell), amount: paise(x.amt as Cell),
      matched_by: "manual", source_ref: x.id, deleted_at: null, sheet_row: i, account_label: String(x.card) });
  }

  // payee rules
  const ruleIds: string[] = [];
  for (const [pat, cat] of Object.entries(rules)) {
    const id = await uid("rule", pat);
    ruleIds.push(id);
    put("rules", { id, pattern: pat, match_kind: "contains", category_id: await uid("category", cat), deleted_at: null });
  }

  return { tables: out, notes, keep: { transactions: txIds, card_emails: emailIds, card_payments: payIds, rules: ruleIds, goals: goalIds } };
}
