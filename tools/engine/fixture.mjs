/** The tables in a data file (as the notify function's {fixture:true} returns them) → shapeData()'s input. */
export function rowsOf(fx, shapeEdits) {
  return {
    tx: fx.transactions, emails: fx.card_emails, pays: fx.card_payments,
    goals: fx.goals, contribs: fx.goal_contributions, rules: fx.rules, settings: fx.settings,
    lastSync: fx.ingest_log && fx.ingest_log[0] ? fx.ingest_log[0].received_at : null,
    edits: fx.payee_rules && fx.txn_notes ? shapeEdits(fx.payee_rules, fx.txn_notes) : { ok: false },
  };
}
