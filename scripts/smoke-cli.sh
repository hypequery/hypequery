#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(pwd)
mkdir -p "$ROOT_DIR/tmp"
WORKDIR=$(mktemp -d "$ROOT_DIR/tmp/hq-smoke-XXXXXX")
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

pushd "$WORKDIR" > /dev/null
pnpm init >/dev/null <<<'\n'
cat <<'PKG' > package.json
{
  "name": "hq-smoke",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "hypequery dev analytics/queries.ts"
  }
}
PKG
CLICKHOUSE_HOST=${CLICKHOUSE_HOST:-http://localhost:8123} \
CLICKHOUSE_DATABASE=${CLICKHOUSE_DATABASE:-default} \
CLICKHOUSE_USERNAME=${CLICKHOUSE_USERNAME:-default} \
CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-hypequery_test} \
HYPEQUERY_SKIP_INSTALL=1 \
NODE_PATH="$ROOT_DIR/node_modules" \
HQ_ROOT="$ROOT_DIR" \
  node --input-type=module <<'NODE'
import path from 'node:path';
const root = process.env.HQ_ROOT;
const { initCommand } = await import(path.resolve(root, 'packages/cli/dist/commands/init.js'));
await initCommand({
  database: 'clickhouse',
  path: 'analytics',
  noInteractive: true,
  force: true,
  noExample: true,
  skipConnection: true,
});
NODE
test -f analytics/queries.ts
grep -q "queries: serve\.queries" analytics/queries.ts
popd > /dev/null
