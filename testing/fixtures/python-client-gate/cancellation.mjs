import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMCPHttpExecutor } from '@hypequery/mcp';
import { eventually } from './utils/eventually.mjs';

const database = process.env.CLICKHOUSE_DATABASE;
assert(/^hq_client_gate_[0-9a-f]{16}$/.test(database));
const secure = ['1', 'true'].includes(process.env.CLICKHOUSE_SECURE ?? '');
const admin = new URL(`${secure ? 'https' : 'http'}://${process.env.CLICKHOUSE_HOST ?? '127.0.0.1'}:${process.env.CLICKHOUSE_PORT ?? '8123'}`);
const authorization = `Basic ${Buffer.from(`${process.env.CLICKHOUSE_USERNAME ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`).toString('base64')}`;
const query = `SELECT elapsed FROM system.processes WHERE current_database = '${database}' AND position(query, 'client_slow') > 0 FORMAT JSONEachRow`;
const active = async () => {
  const response = await fetch(admin, { method: 'POST', headers: { authorization }, body: query, signal: AbortSignal.timeout(2000) });
  assert(response.ok, 'Database observer refused');
  return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('./node_modules/@hypequery/cli/dist/bin/cli.js', import.meta.url)),
    'mcp', '--client-contract-url', 'http://127.0.0.1:8000/v1/client-contract', '--no-telemetry'],
  env: { ...process.env, HYPEQUERY_API_KEY: process.env.HYPEQUERY_TENANT_A_TOKEN }, stderr: 'pipe',
});
transport.stderr?.resume();
const client = new Client({ name: 'database-cancellation-gate', version: '1.0.0' });
const input = { name: 'query_dataset', arguments: { dataset: 'slow', dimensions: [], measures: ['pause'] } };
const measurements = {};
try {
  await client.connect(transport);
  assert.equal((await active()).length, 0);
  const controller = new AbortController();
  const pending = client.callTool(input, undefined, { signal: controller.signal }).then(value => ({ value }), () => ({ cancelled: true }));
  const observed = await eventually(async () => (await active())[0], 'MCP call did not start database work');
  assert(observed.elapsed < 1, 'Observer reached query too late to prove cancellation');
  const before = Date.now();
  controller.abort();
  await pending;
  await eventually(async () => (await active()).length === 0, 'MCP cancellation left database work running', 1500);
  measurements.signalStopMs = Date.now() - before;
  // Exercise the executor's own deadline independently from SDK request cancellation.
  const executor = await createMCPHttpExecutor({ url: 'http://127.0.0.1:8000/v1/client-contract',
    headers: { authorization: `Bearer ${process.env.HYPEQUERY_TENANT_A_TOKEN}` }, executionBudget: { timeoutMs: 500 },
  });
  const deadlineCall = executor.callTool(input.name, input.arguments);
  const timed = await eventually(async () => (await active())[0], 'Deadline call did not start database work');
  assert(timed.elapsed < 1);
  const result = await deadlineCall;
  assert.equal(result.structuredContent.error.code, 'MCP_QUERY_TIMEOUT');
  const expired = Date.now();
  await eventually(async () => (await active()).length === 0, 'MCP deadline left database work running', 1500);
  measurements.deadlineStopMs = Date.now() - expired;
  await writeFile(`${process.env.HYPEQUERY_GATE_OUTPUT}/cancellation.json`, JSON.stringify({ passed: true, ...measurements }, null, 2));
  console.log('MCP SDK cancellation and executor deadline both stopped real ClickHouse work before natural completion.');
} finally {
  await client.close();
  await transport.close();
}
