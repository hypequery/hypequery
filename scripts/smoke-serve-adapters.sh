#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: serve adapters ---'
pnpm --filter @hypequery/serve build >/dev/null
ROOT_DIR=$(pwd)
ROOT_DIR="$ROOT_DIR" node --input-type=module <<'NODE'
const root = process.env.ROOT_DIR;
const { initServe } = await import(`${root}/packages/serve/dist/index.js`);
const { startNodeServer } = await import(`${root}/packages/serve/dist/adapters/node.js`);
const { createFetchHandler } = await import(`${root}/packages/serve/dist/adapters/fetch.js`);

const { define, queries, query } = initServe({ context: () => ({}) });
const api = define({
  queries: queries({
    ping: query.query(async () => ({ ok: true })),
  }),
});
api.route('/ping', api.queries.ping);
const path = '/api/analytics/ping';

let nodeChecked = false;
try {
  const serverControl = await startNodeServer(api.handler, { port: 0, hostname: '127.0.0.1', quiet: true });
  const address = serverControl.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const nodeRes = await fetch(`http://127.0.0.1:${port}${path}`);
  const nodeJson = await nodeRes.json();
  if (!nodeJson.ok) {
    throw new Error('Node adapter response invalid');
  }
  await serverControl.stop();
  nodeChecked = true;
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
    console.warn('Skipping node adapter smoke due to sandbox restrictions.');
  } else {
    throw error;
  }
}

const fetchHandler = createFetchHandler(api.handler);
const fetchRes = await fetchHandler(new Request(`http://localhost${path}`));
const fetchJson = await fetchRes.json();
if (!fetchJson.ok) {
  throw new Error('Fetch adapter response invalid');
}
if (!nodeChecked) {
  console.warn('Node adapter not exercised in this environment.');
}
NODE
echo 'serve adapter smoke passed'
