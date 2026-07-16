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

(
  cd "$WORKDIR"
  HYPEQUERY_SKIP_INSTALL=1 HQ_ROOT="$ROOT_DIR" node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Session } from 'chdb';

const root = process.env.HQ_ROOT;
assert(root, 'HQ_ROOT must point to the repository root');

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

const { initCommand } = await import(
  path.resolve(root, 'packages/cli/dist/commands/init.js')
);
const { generateCommand } = await import(
  path.resolve(root, 'packages/cli/dist/commands/generate.js')
);
const { closeChdbSessionForTesting } = await import(
  path.resolve(root, 'packages/cli/dist/utils/chdb-client.js')
);

await initCommand({
  database: 'chdb',
  chdbPath: dbPath,
  path: 'analytics',
  style: 'datasets',
  allTables: true,
  noInteractive: true,
  force: true,
  noExample: true,
});

await generateCommand({
  output: 'analytics/regenerated-schema.ts',
});

const schema = await readFile('analytics/schema.ts', 'utf8');
const regeneratedSchema = await readFile('analytics/regenerated-schema.ts', 'utf8');
const client = await readFile('analytics/client.ts', 'utf8');
const datasets = await readFile('analytics/datasets.ts', 'utf8');
const config = JSON.parse(await readFile('hypequery.config.json', 'utf8'));

for (const generated of [schema, regeneratedSchema]) {
  assert.match(generated, /events:\s*\{/);
  assert.match(generated, /'id': 'UInt64'/);
  assert.match(generated, /'name': 'String'/);
}
assert.match(client, /chdbAdapter\(\{ session \}\)/);
assert.ok(client.includes(`new Session(${JSON.stringify(dbPath)})`));
assert.match(datasets, /EventsDataset = dataset\('events'/);
assert.deepEqual(config, { database: 'chdb', chdbPath: dbPath });

await closeChdbSessionForTesting();
NODE
)

test ! -f "$WORKDIR/.env"
echo 'cli chdb smoke passed'
