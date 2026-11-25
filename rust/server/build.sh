#!/usr/bin/env bash
# Builds the server's engine (this crate) into supabase/functions/_shared/money/, where engine.ts loads it:
#   money_server.js   wasm-bindgen's JavaScript glue
#   wasm.js           the WebAssembly itself, as text (base64), so it deploys inside the function like any other file
# The folder is build output (not in git): GitHub builds it before every deploy (.github/workflows/supabase.yml).
# Needs the same tools as ../build-web.sh. TOOLCHAIN=+name picks a toolchain (e.g. +ubu here).
set -euo pipefail
cd "$(dirname "$0")/.."
cargo ${TOOLCHAIN:-} build -p money-server --release --target wasm32-unknown-unknown
out=../supabase/functions/_shared/money
rm -rf "$out" && mkdir -p "$out"
wasm-bindgen --target web --no-typescript --out-name money_server --out-dir "$out" target/wasm32-unknown-unknown/release/money_server.wasm
if command -v wasm-opt >/dev/null; then wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals -o "$out/money_server_bg.wasm" "$out/money_server_bg.wasm"
elif [ -n "${CI:-}" ]; then echo "wasm-opt is missing" >&2; exit 1
fi
{
  echo "// Written by rust/server/build.sh: the server's engine (rust/server) as WebAssembly, in base64."
  printf 'export const WASM = "%s";\n' "$(base64 -w0 "$out/money_server_bg.wasm")"
} > "$out/wasm.js"
rm "$out/money_server_bg.wasm"
echo "built $out · $(du -h "$out/wasm.js" | cut -f1)"
