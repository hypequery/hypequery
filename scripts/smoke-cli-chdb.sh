#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: cli chdb ---'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT_DIR/tmp"
WORKDIR="$(mktemp -d "$ROOT_DIR/tmp/hq-cli-chdb-XXXXXX")"

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

cat <<'PKG' > "$WORKDIR/package.json"
{
  "name": "hq-cli-chdb-smoke",
  "private": true,
  "type": "module"
}
PKG

# chDB deliberately is not a dependency of the CLI. Install it in the fixture
# project to verify that the CLI resolves the native driver from the user's cwd.
pnpm --dir "$WORKDIR" add --save-exact chdb@3.2.0 --ignore-workspace >/dev/null

# Compile and load the generated consumer against this branch's package build,
# while keeping chdb resolved from the fixture exactly as it is under npx.
mkdir -p "$WORKDIR/node_modules/@hypequery"
ln -s "$ROOT_DIR/packages/clickhouse" "$WORKDIR/node_modules/@hypequery/clickhouse"

(
  cd "$WORKDIR"
  node --input-type=module <<'NODE'
import path from 'node:path';
import { Session } from 'chdb';

const dbPath = path.resolve('analytics.chdb');
const seedSession = new Session(dbPath);
await seedSession.queryAsync(`
  CREATE TABLE events (
    id UInt64,
    name String,
    created_at DateTime
  ) ENGINE = MergeTree
  ORDER BY id
`);
await seedSession.queryAsync(
  "INSERT INTO events VALUES (1, 'smoke', now())",
);
seedSession.close();
NODE

  HYPEQUERY_SKIP_INSTALL=1 node "$ROOT_DIR/packages/cli/dist/bin/cli.js" init \
    --database chdb \
    --chdb-path "$WORKDIR/analytics.chdb" \
    --path analytics \
    --style datasets \
    --all-tables \
    --no-interactive \
    --force \
    --no-example

  if CLICKHOUSE_HOST= CLICKHOUSE_URL= CLICKHOUSE_DATABASE= \
    BIGQUERY_PROJECT_ID= GOOGLE_APPLICATION_CREDENTIALS= \
    node "$ROOT_DIR/packages/cli/dist/bin/cli.js" generate \
    --output analytics/auto-detected-schema.ts >auto-detect.log 2>&1; then
    cat auto-detect.log
    echo 'Expected dependency-based chdb generation to require an explicit driver.'
    exit 1
  fi
  grep -q 'chDB generation must be explicit' auto-detect.log
  test ! -f analytics/auto-detected-schema.ts

  node "$ROOT_DIR/packages/cli/dist/bin/cli.js" generate \
    --database chdb \
    --chdb-path "$WORKDIR/analytics.chdb" \
    --output analytics/regenerated-schema.ts

  node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const dbPath = path.resolve('analytics.chdb');
const schema = await readFile('analytics/schema.ts', 'utf8');
const regeneratedSchema = await readFile('analytics/regenerated-schema.ts', 'utf8');
const client = await readFile('analytics/client.ts', 'utf8');
const datasets = await readFile('analytics/datasets.ts', 'utf8');

for (const generated of [schema, regeneratedSchema]) {
  assert.match(generated, /events:\s*\{/);
  assert.match(generated, /'id': 'UInt64'/);
  assert.match(generated, /'name': 'String'/);
}
assert.match(client, /chdbAdapter\(\{ session \}\)/);
assert.ok(client.includes(`new Session(${JSON.stringify(dbPath)})`));
assert.match(datasets, /EventsDataset = dataset\('events'/);
NODE
)

test ! -f "$WORKDIR/.env"

"$ROOT_DIR/node_modules/.bin/tsc" \
  --target ES2022 \
  --module NodeNext \
  --moduleResolution NodeNext \
  --strict \
  --skipLibCheck \
  --rootDir "$WORKDIR" \
  --outDir "$WORKDIR/compiled" \
  "$WORKDIR/analytics/client.ts" \
  "$WORKDIR/analytics/schema.ts"

(
  cd "$WORKDIR"
  node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import path from 'node:path';

const { db, session } = await import(path.resolve('compiled/analytics/client.js'));
const rows = await db.rawQuery('SELECT count() AS count FROM events');
assert.equal(String(rows[0].count), '1');
session.close();
NODE
)

echo 'cli chdb smoke passed'
