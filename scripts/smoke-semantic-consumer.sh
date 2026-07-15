#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: semantic consumer ---'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT_DIR/tmp"
WORKDIR="$(mktemp -d "$ROOT_DIR/tmp/hq-semantic-consumer-XXXXXX")"

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

pnpm --filter @hypequery/datasets build >/dev/null
pnpm --filter @hypequery/serve build >/dev/null

mkdir -p "$WORKDIR/node_modules/@hypequery"
ln -s "$ROOT_DIR/packages/datasets" "$WORKDIR/node_modules/@hypequery/datasets"
ln -s "$ROOT_DIR/packages/serve" "$WORKDIR/node_modules/@hypequery/serve"

node "$ROOT_DIR/scripts/utils/write-semantic-consumer-fixtures.mjs" "$WORKDIR"

TSC="$ROOT_DIR/packages/datasets/node_modules/typescript/bin/tsc"

# Compiles a fixture that must fail, and verifies it fails for the expected
# reason so an unrelated breakage (e.g. a broken install) cannot false-pass.
expect_compile_failure() {
  local file="$1"
  local expected_error="$2"
  local label="$3"
  local log="$WORKDIR/${file%.ts}.log"

  if "$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --noEmit "$file" >"$log" 2>&1; then
    cat "$log"
    echo "Expected $label to fail, but it compiled."
    exit 1
  fi

  if ! grep -q "$expected_error" "$log"; then
    cat "$log"
    echo "Expected $label to fail matching \"$expected_error\", but it failed for a different reason."
    exit 1
  fi
}

(
  cd "$WORKDIR"
  "$TSC" --noEmit --project tsconfig.json
  node runtime.mjs

  expect_compile_failure invalid-root-dataset-query.ts \
    "no exported member.*runDatasetQuery" \
    'root dataset-query helper import'

  expect_compile_failure invalid-root-executor.ts \
    "no exported member.*createExecutor" \
    'root executor import'

  expect_compile_failure invalid-deep-import.ts \
    "Cannot find module" \
    'deep serve import'
)

echo 'semantic consumer smoke passed'
