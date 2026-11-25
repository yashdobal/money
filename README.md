# Money

A personal money app for India: what's safe to spend until payday, credit-card bills and their due dates, a salary
planner, goals, spending, which card to pay with (Rewards), and trips paid for with card points. It reads bank and
card alerts from Gmail (a Google Apps Script collector) and, on Android, from bank SMS; keeps the data in Supabase;
and runs as a website (https://yash-money.pages.dev) and an Android app. One app, written in Rust.

Nothing in this repository is about whose money it is. Your banks and cards, your salary figures and your plan are
saved with your account (and set in the app); every test runs on invented data.

## How it's put together
- `rust/core` is the engine: every figure (card bills and payments, the salary planner, goals, the daily figure,
  where you stand, spending, Rewards, Trips). Your banks and cards come from your saved profile (banks, card accounts
  and the cards on each, the words that name a card in a bill payment or your employer in a salary credit, and who a
  family share goes to); your pay, split and fixed payments from your saved plan (Plan → Salary & fixed payments). A
  setup can be brought in from Settings → Your banks and cards, by pasting it or opening a setup link.
  `rust/core/data/cards.json` is the card rulebook for Rewards and Trips: public card, airline and hotel data only,
  each number with its source and the day it was checked.
- `rust/app` is the app (Dioxus, compiled to WebAssembly). `rust/build-web.sh` builds it with `rust/web` (the page,
  the look in `style.css`, fonts, icons, the service worker) into `rust/dist`: that is the website, and the Android
  app carries the same build inside it. See `rust/README.md`.
- `rust/server` is the same engine for the server: `rust/server/build.sh` compiles it into
  `supabase/functions/_shared/money/`, and the functions use it for the home-screen widget's numbers and the 9 PM
  summary, so they are always the app's own figures.
- `android/` is the Android app: a WebView that serves the website from inside the APK for the site's real address,
  with a fingerprint lock, `window.AndroidBridge` (haptics, alerts, the widget, bank SMS, Material You colours), a
  home-screen widget, hourly alerts and shortcuts.
- `supabase/functions`: `ingest` (the collector's hourly sync; it files rows under the accounts in your profile),
  `app` (saves; registers the phone; the Rewards search's AI and web check), `notify` (hourly alerts, the 9 PM
  summary, pruning), `device` (what the phone asks for in the background). `supabase/migrations` is the database's
  design, applied by hand.
- `collector/` is the Apps Script collector. Account numbers that a bank's email leaves out go in the script's
  properties (`AXIS_LAST4`, `SBI_CARD_LAST4`), never in the file.

## Tests
All of them run on `tools/demo/demo-fixture.json`, invented data written by `tools/demo/make_demo.py` (invented banks,
cards, employer and people).
- `cd rust && cargo test`: every figure at 42 moments, what each screen says, the widget and the 9 PM summary, and 102
  changes with what each one saves, against recorded answers (`rust/core/tests/golden`); Trips, Rewards, reversed and
  refunded payments and spending for someone else against figures worked out by hand (`by_hand.rs`); scrambled data
  never crashes (`fuzz.rs`); bank SMS reading.
- `rust/server/deno.test.ts`: the server's engine under Deno in UTC (as Supabase runs) gives the same widget and summary.
- `tools/ui/app.test.mjs`: the website used like a person would (Playwright) on the demo, with pictures of every screen.
- `.github/workflows/checks.yml` runs them on every push; `website.yml` puts the site live after they pass on `main`;
  `android.yml` builds the signed APK (and, on request, runs the demo build in an emulator,
  `tools/android/emulator-shots.sh`); `supabase.yml` deploys the functions.

## Secrets (GitHub → Settings → Secrets and variables → Actions; never in the repository)
- `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`: the Android app's signing key. Keep a copy safe: without it,
  new versions can't install over the app.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: put the website live.
- `SUPABASE_ACCESS_TOKEN`: deploys the Supabase functions.
- In Supabase (Edge Functions → Secrets), not GitHub: `GEMINI_API_KEY` and `TAVILY_API_KEY` for the Rewards search's
  AI reading and web check (both optional, both free plans); `ANTHROPIC_API_KEY` as a fallback for the AI reading.
- The Supabase address and the two public keys in `rust/public-config.json` are public by design: every visitor's
  browser gets them, and row-level security keeps each account to its own rows.

## Rules for this repository
- No real data: no exports, account numbers, salary figures or keys. `.gitignore` blocks the usual files; your own
  setup lives in your account.
- Amounts in the database are integer paise. Every table has `user_id` and row-level security.
- Changes go to `main` once every test passes.
