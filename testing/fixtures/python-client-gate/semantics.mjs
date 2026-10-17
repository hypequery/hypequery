import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { semanticRows } from './utils/semantic-rows.mjs';
import { semanticCases } from './utils/semantic-cases.mjs';

const oracle = JSON.parse(await readFile(`${process.env.HYPEQUERY_GATE_OUTPUT}/semantic-oracle.json`, 'utf8'));
let cases = 0;
for (const [tenant, token] of [['a', process.env.HYPEQUERY_TENANT_A_TOKEN], ['b', process.env.HYPEQUERY_TENANT_B_TOKEN]]) {
  const authorization = `Bearer ${token}`;
  const contractResponse = await fetch('http://127.0.0.1:8000/v1/client-contract', { headers: { authorization } });
  assert(contractResponse.ok);
  const contract = await contractResponse.json();
  const endpoint = contract.endpoints.find(item => item.id === 'joinedOrders');
  assert(endpoint && endpoint.measures['profile.total'].wireType === 'string');
  assert.equal(endpoint.dimensions['profile.label'].nullable, true);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./node_modules/@hypequery/cli/dist/bin/cli.js', import.meta.url)), 'mcp', '--client-contract-url', 'http://127.0.0.1:8000/v1/client-contract', '--no-telemetry'],
    env: { ...process.env, HYPEQUERY_API_KEY: token }, stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({ name: 'semantic-release-gate', version: '1.0.0' });
  try {
    await client.connect(transport);
    for (const [name, input] of Object.entries(semanticCases)) {
      const response = await fetch('http://127.0.0.1:8000/v1/joined', {
        method: 'POST', headers: { authorization, 'content-type': 'application/json', 'x-hypequery-client-schema': endpoint.schemaHash }, body: JSON.stringify(input),
      });
      assert.equal(response.status, 200, `HTTP ${name} failed`);
      assert.deepEqual(semanticRows((await response.json()).data), semanticRows(oracle[tenant][name]));
      const { by, ...rest } = input;
      const result = await client.callTool({ name: 'query_dataset', arguments: { dataset: 'joinedOrders', ...rest, ...(by ? { grain: by } : {}) } });
      assert(!result.isError, `MCP ${name} failed`);
      assert.deepEqual(semanticRows(result.structuredContent.data), semanticRows(oracle[tenant][name]));
      cases++;
    }
  } finally {
    await client.close();
    await transport.close();
  }
}
assert(oracle.a.related.some(row => row['profile.label'] === null && row['profile.total'] === null));
assert(oracle.a.related.some(row => row['profile.total'] === '9007199254740993.12'));
assert.deepEqual(semanticRows(oracle.a.havingTotal), [{ revenue: '60' }]);
assert(oracle.a.time.some(row => row.period.startsWith('2025-12-31')));
await writeFile(`${process.env.HYPEQUERY_GATE_OUTPUT}/semantics.json`, JSON.stringify({ passed: true, cases, transports: ['http', 'mcp'], oracle: 'independent raw SQL', relatedNulls: true, preciseDecimal: true, tenantJoinGuard: true, having: true, timezoneBoundary: true }, null, 2));
console.log('HTTP and actual MCP stdio equal raw SQL for both tenants: related nulls/measures, HAVING and timezone day boundaries.');
