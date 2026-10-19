import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMCPHttpExecutor, createMCPProtocolServer } from '@hypequery/mcp';

const url = 'http://127.0.0.1:8000/v1/client-contract';
const cases = [];
for (const [credential, status] of [['gate-expired-user', 401], ['gate-denied-user', 403]]) {
  const observed = [];
  await assert.rejects(createMCPHttpExecutor({ url, headers: { authorization: `Bearer ${credential}` },
    fetchFn: async (input, init) => {
      const response = await fetch(input, init);
      observed.push({ method: init?.method ?? 'GET', status: response.status });
      return response;
    },
  }), error => {
    assert.equal(error.code, 'MCP_UNAUTHORIZED');
    assert(!error.message.includes(credential));
    return true;
  });
  assert.deepEqual(observed, [{ method: 'GET', status }]);
  cases.push({ scenario: `discovery-${status}`, observed });
}
let credential = process.env.HYPEQUERY_TENANT_A_TOKEN;
const observed = [];
const executor = await createMCPHttpExecutor({ url, headers: () => ({ authorization: `Bearer ${credential}` }),
  fetchFn: async (input, init) => {
    const response = await fetch(input, init);
    observed.push({ method: init?.method ?? 'GET', status: response.status });
    return response;
  },
});
const server = createMCPProtocolServer({ executor });
const client = new Client({ name: 'credential-expiry-gate', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  credential = 'gate-expired-user';
  observed.length = 0;
  const result = await client.callTool({ name: 'query_dataset', arguments: { dataset: 'orders', dimensions: [], measures: ['revenue'] } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'MCP_UNAUTHORIZED');
  assert.deepEqual(observed, [{ method: 'GET', status: 401 }]);
  assert(!JSON.stringify(result).includes(credential));
  cases.push({ scenario: 'sdk-mid-session-expiry', observed });
} finally {
  await client.close();
  await server.close();
}
await writeFile(`${process.env.HYPEQUERY_GATE_OUTPUT}/errors.json`, JSON.stringify({ passed: true, cases }, null, 2));
console.log('Installed MCP rejects unauthorized/forbidden discovery and SDK calls after credential expiry without issuing data POSTs or replaying requests.');
