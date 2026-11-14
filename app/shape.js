/* Supabase rows → what the engine reads (the shape the old Apps Script getData() returned).
   Pure, so the same code runs in two places: the app (rn/src/engine.gen.js) and the server, which works out the
   widget numbers and the 9 PM summary (supabase/functions/_shared/engine.gen.js); tools/rn_engine.mjs writes both.
   Needs refine_() from the collector's rules, which the generator pastes in next to it.

   rows: {tx, emails, pays, goals, contribs, rules, settings, lastSync, edits}
     each table as Supabase returns it for the selects in rn/src/store.js; lastSync = the newest saved sync's
     received_at (or null); edits = {ok, rules, notes} from the payee_rules and txn_notes tables. */
function shapeData(rows) {
  const IST_MS = 330 * 60 * 1000;
  const live = (list) => (list || []).filter((r) => !r.deleted_at);
  const rupees = (p) => (p === null || p === undefined ? null : p / 100);
  const ist = (iso) => new Date(Date.parse(iso) + IST_MS);
  const edits = rows.edits || { ok: false };

  const outTx = live(rows.tx).map((r) => {
    const d = ist(r.occurred_at);
    const t = {
      id: r.source_ref, ts: Date.parse(r.occurred_at), day: d.getUTCDate(), ym: d.toISOString().slice(0, 7),
      account: (r.accounts && r.accounts.aliases[0]) || "", kind: (r.accounts && r.accounts.kind) || "",
      desc: r.description, cat: (r.categories && r.categories.name) || "Other", amt: r.amount / 100, dir: r.direction,
      counted: r.counted,
    };
    const ref = refine_(t.kind, t.desc, r.snippet || "", t.dir);       // exactly what getData() did
    t.desc = ref.description; t.cat = ref.category; t.counted = ref.counted; t.raw = ref.raw;
    return t;
  });

  const events = live(rows.emails).map((e) => ({
    id: e.message_id, ts: Date.parse(e.received_at), last4: e.accounts.last4, type: e.kind,
    amt: e.amount / 100, min: rupees(e.minimum_due), due: e.due_date || "", stmt: e.statement_date || "",
    src: e.sender, issuer: e.accounts.issuer || "",
  }));

  const settings = rows.settings || [];
  const s = {};
  for (const row of settings) s[row.key] = row.value && row.value.v;
  const appState = (settings.find((r) => r.key === "app.state") || {}).value;
  const stateVersion = appState ? appState.version : 0;
  const catRules = {};
  for (const r of live(rows.rules)) catRules[r.pattern] = r.categories ? r.categories.name : "Other";

  return {
    ok: true,
    notesOk: !!edits.ok, notes: edits.notes, payeeRules: edits.rules,
    updatedAt: Date.now(),
    lastRun: rows.lastSync ? Date.parse(rows.lastSync) : null,
    tx: outTx,
    events,
    appVersion: stateVersion,
    // from Phase 3 the app's own saved copy is the truth; before that, rebuild it from the Sheet's tables
    settings: appState ? Object.assign({}, appState.data) : {
      ob: s.opening_balance, obAt: s.opening_balance_at, inc: s.take_home, payDay: s.payday, buffer: s.buffer,
      joined: s.joined_on, seeded: true, migrated: "v4", manual: [], payAssign: {},
      payments: live(rows.pays).filter((p) => p.matched_by === "manual")
        .map((p) => ({ id: p.source_ref, card: p.account_label, date: p.paid_on, amt: p.amount / 100 })),
      goals: live(rows.goals).map((g) => ({ id: g.id, name: g.name, start: rupees(g.start_amount) || 0, target: rupees(g.target),
        prio: g.priority, date: g.target_date })),
      contribs: live(rows.contribs).map((c) => ({ id: c.id, goal: c.goal_id, amt: rupees(c.amount), date: c.on_date })),
      overrides: {}, catRules,
    },
  };
}

/** The edit tables as the engine wants them: {ok, rules: {pattern: category}, notes: {txn_ref: {...}}}. */
function shapeEdits(ruleRows, noteRows) {
  const rules = {}, notes = {};
  for (const x of ruleRows || []) rules[x.pattern] = x.category;
  for (const x of noteRows || []) notes[x.txn_ref] = { category: x.category || null, for_someone_else: !!x.for_someone_else, paid_back: !!x.paid_back, note: x.note || "" };
  return { ok: true, rules, notes };
}
