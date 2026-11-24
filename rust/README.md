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

## The website

    TOOLCHAIN=+stable ./build-web.sh     # needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.130

builds `dist/` (the page, the WebAssembly, the stylesheet and the fonts). GitHub builds it on every change and puts
it live at https://rust.yash-money.pages.dev — a separate address in the same Cloudflare Pages project as the
current website, which isn't touched. `?demo&at=2026-12-08` opens it on the made-up demo data at that date.

Sign-in is the same email code as the current app, with its own session (signing in here doesn't sign you out
there).

## Progress

| Stage | What | State |
|---|---|---|
| 1 | Workspace, GitHub check, the website build and deploy | done |
| 2 | Engine: every figure, Today's words, Plan, Cards, the CSV export, Trips, Rewards | done, matches engine.js at 42 moments |
| 2 | Engine: every change you can make, and what it saves | done, 102 changes match engine.js |
| 3 | Sign-in, loading data, saving, bottom bar, Today | done |
| 4 | Activity, Cards, Plan, Spending, Trips, Rewards, Settings, and their sheets | done |
| 4 | The lock (a code on the web, the fingerprint in the app), laptop layout, haptics | done |
| 4 | Not yet: colour choices, SMS (phone only), the widget (phone only) | to do |
| 5 | Android APK alongside the current one (`rust-NN` releases) | done |
| 5 | The switch | when you say |

## Haptics

`app/src/haptics.rs`: one buzz per kind of moment (a choice changed, a slider notch, a switch, a drag taking hold and
letting go, a limit, saved, refused), the phone's own haptics in the app (`MainActivity.haptic`) and
`navigator.vibrate` in a phone's browser. A stronger buzz wins over a weaker one fired at the same moment, so one tap
that saves gives one buzz. Settings → Vibration turns them off.

The card rulebooks (`core/data/cards.json`) are written out of `app/trips.js` and `app/rewards.js` by
`node tools/rust/data.mjs`; GitHub checks they're the same.
