# Money in Rust

The Money app rebuilt in Rust, next to the current one. The current app (`rn/` and `app/`) stays the one you use
until this one does everything it does; then we switch.

- `core/` — the engine: every figure (card bills, Safe to spend, Plan, spending, Rewards, Trips), ported from
  `app/engine.js` (and `app/shape.js`, the collector's category rules) function by function, same names in
  snake_case.
- `app/` — the screens, in [Dioxus](https://dioxuslabs.com), compiled to WebAssembly for the website and the Android
  app.

## The parity check

`core/tests/parity.rs` runs both engines on the demo data (`tools/demo/demo-fixture.json`) at 42 moments between
October and February and compares every figure of `snapshot()` (the same check the server's engine uses). The
JavaScript side is `tools/rust/snapshot.mjs`. A change to `app/engine.js` that isn't made here too fails it.

    cd rust && cargo test

## Progress

| Stage | What | State |
|---|---|---|
| 1 | Workspace, GitHub check | done |
| 2 | Engine: cards, payments, balances, planner, forecast, hero, where you stand, spending | done, matches engine.js |
| 2 | Engine: Coming up, Needs attention, EMIs, card payments | ported, not yet in the parity check |
| 2 | Engine: actions (edit, notes, settings), Rewards, Trips, balance history | to do |
| 3 | Sign-in, loading data, bottom bar, Today | to do |
| 4 | Activity, Cards, Plan, Spending, Rewards, Trips, Settings | to do |
| 5 | Android APK alongside the current one, then the switch | to do |
