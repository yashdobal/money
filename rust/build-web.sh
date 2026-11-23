#!/usr/bin/env bash
# Builds the Rust app for the web into rust/dist: the WebAssembly (release), its JavaScript glue (wasm-bindgen), the page,
# the stylesheet and the fonts. Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at the same version as
# the wasm-bindgen crate in Cargo.lock. TOOLCHAIN=+name picks a toolchain (e.g. +ubu here).
set -euo pipefail
cd "$(dirname "$0")"
cargo ${TOOLCHAIN:-} build -p money-app --release --target wasm32-unknown-unknown
rm -rf dist && mkdir -p dist/fonts
wasm-bindgen --target web --no-typescript --out-name money_app --out-dir dist target/wasm32-unknown-unknown/release/money-app.wasm
# wasm-opt (binaryen, npm i -g binaryen) makes it about a third smaller; GitHub always has it
if command -v wasm-opt >/dev/null; then wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals -o dist/money_app_bg.wasm dist/money_app_bg.wasm
elif [ -n "${CI:-}" ]; then echo "wasm-opt is missing" >&2; exit 1
else echo "(no wasm-opt here, so the WebAssembly isn't shrunk)"; fi
BUILD=$(sha256sum dist/money_app_bg.wasm | cut -c1-10)
sed "s/__BUILD__/$BUILD/g" web/index.html > dist/index.html
cp web/style.css dist/style.css
cp ../tools/demo/demo-fixture.json dist/demo.json   # the demo's made-up data, fetched only when the demo opens
cp ../app/fonts/anek-latin.woff2 ../app/fonts/anek-rupee.woff2 ../app/fonts/OFL.txt dist/fonts/
printf '{"build":"%s"}\n' "$BUILD" > dist/version.json
# (no 404.html, so Cloudflare Pages answers every address with index.html: the app has no pages of its own)
echo "built rust/dist · $BUILD · $(du -h dist/money_app_bg.wasm | cut -f1) wasm"
