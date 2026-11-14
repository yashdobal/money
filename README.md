# Money

A personal money app for India: what's safe to spend until payday, credit-card bills and their due dates, a salary
planner, goals, spending, and trips paid for with card points. It reads bank and card alerts from Gmail (a Google Apps
Script collector), keeps the data in Supabase, and runs as a website and an Android app.

Nothing in this repository is about whose money it is. Your banks and cards, your salary figures and your plan are
saved with your account (and set in the app); every test runs on invented data.

## How it's put together
- `app/engine.js` works out every figure: card bills and payments, the salary planner, goals, the daily figure and
  where you stand. Your banks and cards come from your saved profile (`applyProfile`: banks, card accounts and the
  cards on each, the words that name a card in a bill payment or your employer in a salary credit, and who a family
  share goes to); your pay, split and fixed payments from your saved `cfg` (Plan → Salary & fixed payments). A setup
  can be brought in from Settings → Your banks and cards, by pasting it or opening a setup link.
- `app/shape.js` turns the database rows into what the engine reads; `app/trips.js` is the Trips tab (public card,
  airline and hotel data only, each number with its source and the day it was checked).
- `app/rewards.js` is the Rewards tab: "what are you buying?" → the best card you hold and the way to pay (straight on
  the card, HDFC SmartBuy, a SmartBuy brand voucher, Amazon Pay), worth as cash and as airline or hotel points, with
  bonus rates, spending that earns nothing and caps (counting what this month's spending already used); the cards you
  could get on your income that would do better; this month's points, what you left on the table, your next card, and
  milestones. The card rules are public data with sources and a checked date. An AI model reads what you type (the
  `app` function's `rew-parse`, with `ANTHROPIC_API_KEY` in Supabase); without the key the app reads it by keywords.
- `rn/` is the app (React Native, Expo). It is also the website: `tools/build_site.py` builds it for the browser
  (react-native-web) into `dist/`, which Cloudflare Pages serves, with a sidebar and two columns on a wide window. What
  differs between the phone, a browser and the Android app's WebView lives in `rn/src/host.js` and
  `rn/src/native/*.web.js`. The look (bento: grey trays of white cards, one accent colour, Anek Latin) is in
  `rn/src/theme.js` and `rn/src/kit.js`; the movement in `rn/src/motion.js` and `rn/src/alive.js`.
- `tools/rn_engine.mjs` writes the engine's two copies: `rn/src/engine.gen.js` for the app and
  `supabase/functions/_shared/engine.gen.js` for the server, which runs it with India's time (`ist-date.js`) for the
  widget and the 9 PM summary.
- `android/` is the Android app: a WebView that serves the website from inside the APK for the site's real address,
  with a fingerprint lock, `window.AndroidBridge`, a home-screen widget, hourly alerts and shortcuts. GitHub Actions
  builds and signs it (`.github/workflows/android.yml`) and attaches it to a Release on `main`.
- `supabase/functions`: `ingest` (the collector's hourly sync; it files rows under the accounts in your profile),
  `app` (saves; registers the phone), `notify` (hourly web-push alerts, the 9 PM summary, pruning), `device` (what the
  phone asks for in the background). Deployed by `.github/workflows/supabase.yml`. `supabase/migrations` is the
  database's design, applied by hand.
- `collector/` is the Apps Script collector. Account numbers that a bank's email leaves out go in the script's
  properties (`AXIS_LAST4`, `SBI_CARD_LAST4`), never in the file.

## Tests
All of them run on `tools/demo/demo-fixture.json`, invented data written by `tools/demo/make_demo.py` (invented banks,
cards, employer and people).
- `tools/rn/engine.test.mjs`: the app's engine gives the server's figures. `tools/engine/ist.test.mjs`: the server's
  figures are the same in UTC (as Supabase runs) as in India. `tools/rn/trips.test.mjs` and `tools/rn/rewards.test.mjs`:
  the Trips and Rewards maths against figures worked out by hand.
- `tools/ui/rn.click.test.mjs`: the app used like a person would (Playwright). `tools/ui/site.test.mjs`: the website
  as served (every screen moving, address and Back, links, the lock code, the alerts offer, the laptop layout, and
  inside the Android app with a stand-in bridge). `rn.shots.mjs` and `site.shots.mjs` take pictures of every screen.
- `.github/workflows/checks.yml` runs them on every push; `android.yml` also runs the demo build in an emulator on
  request (`tools/android/emulator-shots.sh`); `website.yml` puts `dist/` live after the checks pass on `main`.

## Secrets (GitHub → Settings → Secrets and variables → Actions; never in the repository)
- `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`: the Android app's signing key. Keep a copy safe: without it,
  new versions can't install over the app.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: put the website live.
- `SUPABASE_ACCESS_TOKEN`: deploys the Supabase functions.
- In Supabase (Edge Functions → Secrets), not GitHub: `ANTHROPIC_API_KEY` for the Rewards search's AI step (optional).
- The Supabase address and the two public keys in `app/public-config.json` are public by design: every visitor's
  browser gets them, and row-level security keeps each account to its own rows.

## Rules for this repository
- No real data: no exports, account numbers, salary figures or keys. `.gitignore` blocks the usual files; your own
  setup lives in your account.
- Amounts in the database are integer paise. Every table has `user_id` and row-level security.
- Changes go to `main` once every test passes.
