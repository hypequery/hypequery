import assert from 'node:assert/strict';
import { createMCPHttpExecutor, createMCPProtocolServer } from '@hypequery/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const connection = async token => {
  const executor = await createMCPHttpExecutor({
    url: process.env.HYPEQUERY_TEST_CLIENT_CONTRACT_URL ?? 'http://127.0.0.1:8790/mounted/v1/client-contract',
    headers: { authorization: `Bearer ${token}` },
  });
  const server = createMCPProtocolServer({ executor });
  const client = new Client({ name: 'installed-python-http-smoke', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
};
const alice = await connection('browser-a');
const bob = await connection('browser-b');
try {
  assert.equal((await alice.client.listTools()).tools.length, 4);
  const query = { name: 'query_dataset', arguments: { dataset: 'orders', dimensions: ['country'], measures: ['revenue'], orderBy: [{ field: 'country', direction: 'asc' }], includeMeta: true, limit: 1 } };
  const first = (await alice.client.callTool(query)).structuredContent;
  assert.deepEqual(first.data, [{ country: null, revenue: '30' }]);
  assert.equal(first.meta.pagination.hasMore, true);
  assert.equal(first.meta.cache.hit, false);
  const next = (await alice.client.callTool({ ...query, arguments: { ...query.arguments, offset: 1 } })).structuredContent;
  assert.deepEqual(next.data, [{ country: 'UK', revenue: '10' }]);
  const aMetric = (await alice.client.callTool({ name: 'query_metric', arguments: { dataset: 'orders', metric: 'sales' } })).structuredContent;
  const bMetric = (await bob.client.callTool({ name: 'query_metric', arguments: { dataset: 'orders', metric: 'sales' } })).structuredContent;
  assert.deepEqual(aMetric.data, [{ sales: '60' }]);
  assert.deepEqual(bMetric.data, [{ sales: '1000' }]);
  const invalid = await alice.client.callTool({ name: 'query_dataset', arguments: { ...query.arguments, tenant: 'b', sql: 'PRIVATE_SQL' } });
  assert.equal(invalid.structuredContent.error.code, 'MCP_INVALID_ARGUMENTS');
  assert(!JSON.stringify(invalid).includes('PRIVATE_SQL'));
  console.log('Packed MCP → installed Python HTTP smoke passed: tools, metric alias, nulls, paging, metadata, two principals and rejected context/SQL.');
} finally {
  await alice.client.close(); await alice.server.close();
  await bob.client.close(); await bob.server.close();
}
