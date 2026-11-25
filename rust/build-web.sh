#!/usr/bin/env bash
# Builds Money for the web into rust/dist: the website (yash-money.pages.dev) and what the Android app carries inside it.
# The WebAssembly (release), its JavaScript glue (wasm-bindgen), the page, the stylesheet, the fonts and icons, the
# service worker, the install manifest, the status page and the demo's made-up data. Needs the wasm32-unknown-unknown
# target and wasm-bindgen-cli at the same version as the wasm-bindgen crate in Cargo.lock; wasm-opt (binaryen) makes it
# about a third smaller. TOOLCHAIN=+name picks a toolchain (e.g. +ubu here).
set -euo pipefail
cd "$(dirname "$0")"
cargo ${TOOLCHAIN:-} build -p money-app --release --target wasm32-unknown-unknown
rm -rf dist && mkdir -p dist
wasm-bindgen --target web --no-typescript --out-name money_app --out-dir dist target/wasm32-unknown-unknown/release/money-app.wasm
if command -v wasm-opt >/dev/null; then wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals -o dist/money_app_bg.wasm dist/money_app_bg.wasm
elif [ -n "${CI:-}" ]; then echo "wasm-opt is missing" >&2; exit 1
else echo "(no wasm-opt here, so the WebAssembly isn't shrunk)"; fi
BUILD=$(cat dist/money_app_bg.wasm web/style.css web/index.html web/host.js | sha256sum | cut -c1-10)

# the files as they are
cp -r web/fonts web/icons web/.well-known dist/
cp web/style.css web/host.js web/manifest.webmanifest web/_headers dist/
cp ../tools/demo/demo-fixture.json dist/demo.json   # the demo's made-up data, fetched only when the demo opens
sed "s/__BUILD__/$BUILD/g" web/index.html > dist/index.html
# the status page gets the public key (the same one every visitor's browser gets)
KEY=$(python3 -c "import json;print(json.load(open('public-config.json'))['SUPABASE_PUBLISHABLE_KEY'])")
grep -q "%SUPABASE_PUBLISHABLE_KEY%" web/status.html || { echo "status.html: the key's place moved" >&2; exit 1; }
sed "s/%SUPABASE_PUBLISHABLE_KEY%/$KEY/" web/status.html > dist/status.html
# the service worker: this build's name and the files it keeps for opening offline
SHELL_LIST=$(cd dist && python3 -c "
import json, os
keep = ['/', '/index.html', '/style.css', '/host.js', '/money_app.js', '/money_app_bg.wasm', '/manifest.webmanifest', '/fonts/anek-latin.woff2', '/fonts/anek-rupee.woff2',
        '/icons/icon-192.png', '/icons/badge-96.png', '/icons/mark.svg']
for f in keep: assert f == '/' or os.path.exists(f[1:]), f
print(json.dumps(keep))")
sed -e "s|%BUILD%|$BUILD|g" -e "s|%SHELL%|$SHELL_LIST|" web/sw.js > dist/sw.js
printf '{"build":"%s"}\n' "$BUILD" > dist/version.json
# (no 404.html, so Cloudflare Pages answers every address with index.html: the app has no pages of its own)
echo "built rust/dist · $BUILD · $(du -h dist/money_app_bg.wasm | cut -f1) wasm"
