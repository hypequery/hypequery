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
pnpm --filter @hypequery/schema build >/dev/null
pnpm --filter @hypequery/serve build >/dev/null

mkdir -p "$WORKDIR/node_modules/@hypequery"
ln -s "$ROOT_DIR/packages/datasets" "$WORKDIR/node_modules/@hypequery/datasets"
ln -s "$ROOT_DIR/packages/schema" "$WORKDIR/node_modules/@hypequery/schema"
ln -s "$ROOT_DIR/packages/serve" "$WORKDIR/node_modules/@hypequery/serve"

node "$ROOT_DIR/scripts/utils/write-semantic-consumer-fixtures.mjs" "$WORKDIR"

TSC="$ROOT_DIR/packages/datasets/node_modules/typescript/bin/tsc"

(
  cd "$WORKDIR"
  "$TSC" --noEmit --project tsconfig.json
  node runtime.mjs

  if "$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --noEmit invalid-root-dataset-query.ts >/tmp/hq-invalid-root.log 2>&1; then
    cat /tmp/hq-invalid-root.log
    echo 'Expected root dataset-query helper import to fail, but it compiled.'
    exit 1
  fi

  if "$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --noEmit invalid-deep-import.ts >/tmp/hq-invalid-deep.log 2>&1; then
    cat /tmp/hq-invalid-deep.log
    echo 'Expected deep serve import to fail, but it compiled.'
    exit 1
  fi
)

echo 'semantic consumer smoke passed'
