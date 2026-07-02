#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: docs snippets ---'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT_DIR/tmp"
WORKDIR="$(mktemp -d "$ROOT_DIR/tmp/hq-docs-snippets-XXXXXX")"

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

pnpm --filter @hypequery/clickhouse build >/dev/null
pnpm --filter @hypequery/datasets build >/dev/null
pnpm --filter @hypequery/serve build >/dev/null

mkdir -p "$WORKDIR/node_modules/@hypequery"
ln -s "$ROOT_DIR/packages/clickhouse" "$WORKDIR/node_modules/@hypequery/clickhouse"
ln -s "$ROOT_DIR/packages/datasets" "$WORKDIR/node_modules/@hypequery/datasets"
ln -s "$ROOT_DIR/packages/serve" "$WORKDIR/node_modules/@hypequery/serve"
ln -s "$ROOT_DIR/packages/datasets/node_modules/@types" "$WORKDIR/node_modules/@types"

node "$ROOT_DIR/scripts/utils/write-docs-snippet-fixtures.mjs" "$WORKDIR"

TSC="$ROOT_DIR/packages/datasets/node_modules/typescript/bin/tsc"

(
  cd "$WORKDIR"
  "$TSC" --noEmit --project tsconfig.json
)

echo 'docs snippets smoke passed'
