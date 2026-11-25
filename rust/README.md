# Money in Rust

The whole app: the engine, the screens, and the engine again for the server.

- `core/` — the engine: every figure (card bills, Safe to spend, Plan, spending, Rewards, Trips), the card rulebook
  (`data/cards.json`), reading the bank's words (`refine.rs`) and bank SMS (`sms.rs`).
- `app/` — the screens, in [Dioxus](https://dioxuslabs.com), compiled to WebAssembly. `native.rs` is what the phone and
  the browser do for it (the widget, alerts and web push, the device key, the Android app's answers), `sms.rs` the
  phone's bank SMS, `haptics.rs` the buzzes, `lock.rs` the lock.
- `server/` — the engine for the Supabase functions: `build.sh` compiles it to WebAssembly and writes it into
  `../supabase/functions/_shared/money/` (built by GitHub before each deploy; not kept in git).
- `web/` — the page around the app: `index.html` (light or dark and the colour choice before anything draws),
  `style.css` (the look), `host.js` and `sw.js` (the service worker: opening offline, web push), fonts, icons, the
  install manifest, the status page.

## Checks

    cd rust && cargo test

`core/tests/parity.rs` works out every figure on the demo data (`../tools/demo/demo-fixture.json`) at 42 moments
between October and February, what each screen says, the widget and the 9 PM summary; `actions.rs` makes 102 changes
one after another and checks what each returns, saves and writes. Both compare with recorded answers in
`core/tests/golden` (first recorded from the original JavaScript engine). A change that means to alter a figure
rewrites them on purpose — `UPDATE_GOLDEN=1 cargo test -p money-core` — and the diff shows what moved.
`by_hand.rs` checks Trips, Rewards, reversed and refunded payments and spending for someone else against figures
worked out by hand; `fuzz.rs` scrambles the demo data (`FUZZ_N=5000` for more) and nothing may crash.

`server/deno.test.ts` runs the server's build under Deno in UTC and checks it gives the recorded widget and summary.

## Building

    TOOLCHAIN=+stable ./build-web.sh      # needs the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.130, wasm-opt

builds `dist/`: the website (https://yash-money.pages.dev) and what the Android app carries. `?demo` opens it on the
made-up demo data (`?demo&at=2026-12-08` at that date).

    TOOLCHAIN=+stable ./server/build.sh   # the server's engine

## Haptics

`app/src/haptics.rs`: one buzz per kind of moment (a choice changed, a slider notch, a switch, a drag taking hold and
letting go, a limit, saved, refused), the phone's own haptics in the app (`MainActivity.haptic`) and
`navigator.vibrate` in a phone's browser. A stronger buzz wins over a weaker one fired at the same moment, so one tap
that saves gives one buzz. Settings → Vibration turns them off.

## Bank SMS

Android only, in the `-sms` APK (the `releaseSms` build: Google Play Protect in India may refuse to install an app
that reads SMS from a browser download, so the plain APK leaves the permission out and always installs). Off until you
turn it on (Settings → Alerts → Read bank SMS). The app reads only messages from your
banks' senders (`android/…/Sms.kt` filters them), `core/src/sms.rs` reads each as a payment, and it waits in Activity
until the bank's email for it arrives (then the email takes its place). "Count them straight away" puts the waiting
ones into every figure at once. What's read stays on the phone.
