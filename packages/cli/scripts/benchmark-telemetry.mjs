import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), 'hq-telemetry-benchmark-'));
const bin = fileURLToPath(new URL('../dist/bin/cli.js', import.meta.url));
const server = createServer(() => { /* Intentionally blackhole the response. */ });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/batch`;
const env = { ...process.env, HYPEQUERY_CONFIG_DIR: directory };
for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED', 'HYPEQUERY_TELEMETRY_DEBUG', 'HYPEQUERY_TELEMETRY_URL', 'GITHUB_ACTIONS']) delete env[key];
async function sample(variables) {
  const start = performance.now();
  const result = await run(process.execPath, [bin, '--version'], { cwd: directory, env: variables, timeout: 2_000 });
  return { elapsed: performance.now() - start, ...result };
}
try {
  await run(process.execPath, [bin, 'telemetry', 'status'], { cwd: directory, env });
  const overheads = [];
  for (let index = 0; index < 30; index++) {
    const baseline = await sample({ ...env, DO_NOT_TRACK: '1' });
    const blackholed = await sample({ ...env, HYPEQUERY_TELEMETRY_URL: endpoint });
    assert.equal(blackholed.stdout, baseline.stdout);
    assert.equal(blackholed.stderr, baseline.stderr);
    overheads.push(blackholed.elapsed - baseline.elapsed);
  }
  overheads.sort((a, b) => a - b);
  const p99 = overheads[Math.ceil(0.99 * overheads.length) - 1];
  console.log(JSON.stringify({ samples: overheads.length, metric: 'additional exit latency vs disabled CLI', p50_ms: Math.round(overheads[Math.floor(overheads.length / 2)]), p99_ms: Math.round(p99), budget_ms: 100 }));
  assert(p99 < 100, `Blackholed telemetry added ${p99.toFixed(1)}ms at p99 (budget: <100ms).`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
