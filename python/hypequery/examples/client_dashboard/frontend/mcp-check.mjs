import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = process.env.HYPEQUERY_CLIENT_CONTRACT_URL ?? 'http://127.0.0.1:8000/v1/client-contract';
const tokens = [process.env.HYPEQUERY_TENANT_A_TOKEN, process.env.HYPEQUERY_TENANT_B_TOKEN];
assert(tokens.every(token => token?.trim()) && tokens[0] !== tokens[1], 'Set distinct tutorial A/B token environment variables.');
for (const [index, token] of tokens.entries()) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./node_modules/@hypequery/cli/dist/bin/cli.js', import.meta.url)),
      'mcp', '--client-contract-url', url, '--no-telemetry'],
    env: { ...process.env, HYPEQUERY_API_KEY: token }, stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'python-tutorial-check', version: '1.0.0' });
  let pid;
  try {
    await client.connect(transport);
    pid = transport.pid;
    assert.equal((await client.listTools()).tools.length, 4);
    const metric = await client.callTool({ name: 'query_metric', arguments: { dataset: 'orders', metric: 'sales' } });
    assert(!metric.isError);
    assert.match(metric.structuredContent.data[0].sales, index === 0 ? /^60(?:\.0+)?$/ : /^1000(?:\.0+)?$/);
    const rows = [];
    for (let offset = 0; offset < (index === 0 ? 3 : 2); offset++) {
      const result = await client.callTool({ name: 'query_dataset', arguments: {
        dataset: 'orders', dimensions: ['country'], measures: ['revenue'],
        orderBy: [{ field: 'country', direction: 'asc' }], limit: 1, offset, includeMeta: true,
      } });
      assert(!result.isError);
      rows.push(...result.structuredContent.data);
      assert.equal(result.structuredContent.meta.pagination.hasMore, offset < (index === 0 ? 2 : 1));
    }
    assert.deepEqual(new Set(rows.map(row => row.country)), new Set(index === 0 ? ['US', 'DE', null] : ['CA', 'UK']));
    const invalid = await client.callTool({ name: 'query_dataset', arguments: { dataset: 'orders', sql: 'SELECT 1', tenant: 'b' } });
    assert.equal(invalid.structuredContent.error.code, 'MCP_INVALID_ARGUMENTS');
  } finally {
    await client.close();
    await transport.close();
    if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert(tokens.every(value => !stderr.includes(value)));
  }
}
console.log('Installed CLI → Python → ClickHouse passed: both principals, metric, nullable pages, metadata, rejected context/SQL and child shutdown.');
