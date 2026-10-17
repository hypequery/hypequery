import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { prepareProtocolClientContract } from '@hypequery/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMCPHttpExecutor } from './http-executor.js';
import { HypequeryMCPProtocolServer } from './protocol-server.js';

const source = JSON.parse(readFileSync(new URL('../../../specs/security-protocol/fixtures/client-contract-v1/success.json', import.meta.url), 'utf8'))[0].value;
function authorized(endpoints = source.endpoints, view = 'authorized') {
  return prepareProtocolClientContract({ kind: source.kind, version: 1, view,
    endpoints: endpoints.map(({ schemaHash: _hash, ...endpoint }: Record<string, unknown>) => endpoint),
  }).contract;
}
const contract = authorized();
const url = 'https://python.example.test/mounted/client-contract';
const args = { dataset: 'orders', dimensions: ['country'], measures: ['revenue'] };
const rows = { data: [{ country: 'UK', revenue: '12' }] };
function json(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function backend(query: () => Response | Promise<Response> = () => json(rows)) {
  const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST' ? query() : json(contract));
  return fetchFn;
}
function code(result: any): string { return result.structuredContent.error.code; }
async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

describe('authorized HTTP MCP executor', () => {
  it('executes through the advertised path, pin and normalized body, without local SQL/tenant routing', async () => {
    const fetchFn = backend();
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, headers: { authorization: 'Bearer PRIVATE_TOKEN' } });
    const result = await executor.callTool('query_dataset', { ...args, limit: 10000 });
    expect(result.structuredContent).toEqual(rows);
    const post = fetchFn.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(post[0]).toBe('https://python.example.test/api/v1/datasets/orders/query');
    expect(post[1]).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    expect(new Headers(post[1]?.headers).get('authorization')).toBe('Bearer PRIVATE_TOKEN');
    expect(new Headers(post[1]?.headers).get('x-hypequery-client-schema')).toBe(source.endpoints.find((endpoint: any) => endpoint.id === 'orders').schemaHash);
    expect(JSON.parse(post[1]?.body as string)).toEqual({ dimensions: ['country'], measures: ['revenue'], filters: [], having: [], orderBy: [], limit: 1000, offset: 0, includeMeta: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
  });

  it('preserves default measures and translates grain to by with metric routing removed', async () => {
    const fetchFn = backend(() => json({ data: [{ revenue: '12', period: '2026-01-01 00:00:00' }] }));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const metric = await executor.callTool('query_metric', { dataset: 'orders', metric: 'ordersRevenue', grain: 'day' });
    expect(metric.isError).toBeUndefined();
    const post = fetchFn.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]?.body as string)).toEqual({ dimensions: [], filters: [], orderBy: [], limit: 20, offset: 0, includeMeta: false, by: 'day' });
    expect(post[0]).toBe('https://python.example.test/api/v1/metrics/revenue');
    const defaults = backend(() => json({ data: [{ revenue: '12', orderCount: '2', latestLabel: null }] }));
    const other = await createMCPHttpExecutor({ url, fetchFn: defaults as typeof fetch });
    expect((await other.callTool('query_dataset', { dataset: 'orders' })).isError).toBeUndefined();
    expect(JSON.parse(defaults.mock.calls.find(call => call[1]?.method === 'POST')![1]?.body as string).measures).toEqual(['revenue', 'orderCount', 'latestLabel']);
  });

  it.each([
    { ...args, sql: 'PRIVATE_SQL' }, { ...args, tenant: 'PRIVATE_TENANT' }, { ...args, url: 'https://evil.test' },
    { ...args, token: 'PRIVATE_TOKEN' }, { ...args, dimensions: ['unknown'] }, { ...args, limit: 0 },
    { ...args, filters: [{ field: 'amount', operator: 'eq', value: '1' }] },
    { ...args, having: [{ measure: 'orderCount', operator: 'eq', value: 1 }] },
    { ...args, orderBy: [{ field: 'amount', direction: 'asc' }] }, { ...args, timezone: 'utc' },
    { ...args, by: 'day' }, { ...args, offset: 10001 }, { ...args, measures: null }, { ...args, dimensions: ['country', 'country'] },
  ])('rejects invalid model arguments without even fetching discovery', async input => {
    const fetchFn = backend();
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    expect(code(await executor.callTool('query_dataset', input))).toBe('MCP_INVALID_ARGUMENTS');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not invoke argument getters or expose reflection exceptions', async () => {
    const fetchFn = backend();
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const getter = vi.fn(() => 'orders');
    expect(code(await executor.callTool('query_dataset', Object.defineProperty({}, 'dataset', { get: getter, enumerable: true })))).toBe('MCP_INVALID_ARGUMENTS');
    expect(getter).not.toHaveBeenCalled();
    const hostile = new Proxy({}, { ownKeys() { throw new Error('PRIVATE_EXCEPTION'); } });
    const result = await executor.callTool('list_datasets', hostile);
    expect(code(result)).toBe('MCP_INVALID_ARGUMENTS');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not synthesize a dataset target from a metric-only view', async () => {
    const onlyMetric = authorized(source.endpoints.filter((endpoint: any) => endpoint.kind === 'metric'));
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST' ? json({ data: [{ revenue: '12' }] }) : json(onlyMetric));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_INVALID_ARGUMENTS');
    const list = (await executor.callTool('list_datasets')).structuredContent as any;
    expect(list.datasets).toMatchObject([{ name: 'orders', queryable: false, metricCount: 1 }]);
    const profile = (await executor.callTool('get_dataset_schema', { dataset: 'orders' })).structuredContent as any;
    expect(profile.endpoints).toHaveLength(1);
    expect(profile.endpoints[0].kind).toBe('metric');
    expect(profile.endpoints[0]).not.toHaveProperty('path');
    expect((await executor.callTool('query_metric', { dataset: 'orders', metric: 'ordersRevenue' })).isError).toBeUndefined();
  });

  it('keeps empty views uncallable and returns detached manifests', async () => {
    const fetchFn = vi.fn(async () => json(authorized([])));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const first = await executor.listTools();
    expect(first.tools.map(tool => tool.name)).toEqual(['list_datasets', 'get_dataset_schema', 'query_metric', 'query_dataset']);
    expect((await executor.callTool('list_datasets')).structuredContent).toEqual({ datasets: [], total: 0 });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_INVALID_ARGUMENTS');
    first.tools.length = 0;
    expect((await executor.listTools()).tools).toHaveLength(4);
  });

  it('invalidates the session on a changed authorized view before posting, and requires a new executor', async () => {
    let current = contract;
    const fetchFn = vi.fn(async () => json(current));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const hash = executor.getManifestHash();
    current = authorized(source.endpoints.filter((endpoint: any) => endpoint.kind === 'metric'));
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_STALE_CONTRACT');
    const calls = fetchFn.mock.calls.length;
    current = contract;
    await expect(executor.listTools()).rejects.toMatchObject({ code: 'MCP_STALE_CONTRACT', retryable: false });
    expect(code(await executor.callTool('list_datasets'))).toBe('MCP_STALE_CONTRACT');
    expect(fetchFn).toHaveBeenCalledTimes(calls);
    expect(executor.getManifestHash()).toBe(hash);
  });

  it('invalidates when limits change even if the endpoint schema pin remains the same', async () => {
    const changed = authorized(source.endpoints.map((endpoint: any) => ({ ...endpoint, limits: { ...endpoint.limits, maxLimit: 10, defaultLimit: 10 } })));
    expect(changed.endpoints.map(endpoint => endpoint.schemaHash)).toEqual(contract.endpoints.map((endpoint: any) => endpoint.schemaHash));
    let current = contract;
    const fetchFn = vi.fn(async () => json(current));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    current = changed;
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_STALE_CONTRACT');
  });

  it.each([401, 403, 409, 429, 500, 307])('maps backend %s without exposing its error body or replaying a POST', async status => {
    const cancel = vi.fn();
    const fetchFn = backend(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_SQL_TOKEN_TENANT')); }, cancel }), {
      status, headers: { 'content-type': 'text/plain', location: 'https://PRIVATE.test' },
    }));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const result = await executor.callTool('query_dataset', args);
    expect(code(result)).toBe(status === 401 || status === 403 ? 'MCP_UNAUTHORIZED' : status === 409 ? 'MCP_STALE_CONTRACT' : 'MCP_EXECUTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(fetchFn.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    if (status === 409) await expect(executor.listTools()).rejects.toMatchObject({ code: 'MCP_STALE_CONTRACT' });
  });

  it('honors a newer backend denial even when discovery still advertises the same endpoint', async () => {
    const fetchFn = backend(() => json({ error: { sql: 'PRIVATE' } }, 403));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_UNAUTHORIZED');
  });

  it('enforces caller cancellation and aborts a running POST', async () => {
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    let upstream: AbortSignal | undefined;
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== 'POST') return json(contract);
      upstream = init.signal!;
      start();
      return new Promise<Response>((_resolve, reject) => upstream!.addEventListener('abort', () => reject(new Error('PRIVATE_CANCEL')), { once: true }));
    });
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const controller = new AbortController();
    const pending = executor.callTool('query_dataset', args, controller.signal);
    await started;
    controller.abort('PRIVATE_REASON');
    expect(code(await pending)).toBe('MCP_REQUEST_CANCELLED');
    expect(upstream?.aborted).toBe(true);
    const calls = fetchFn.mock.calls.length;
    expect(code(await executor.callTool('query_dataset', args, controller.signal))).toBe('MCP_REQUEST_CANCELLED');
    expect(fetchFn).toHaveBeenCalledTimes(calls);
  });

  it('aborts discovery requests when list and prompt calls are cancelled', async () => {
    for (const call of [
      (executor: any, signal: AbortSignal) => executor.listTools(signal),
      (executor: any, signal: AbortSignal) => executor.listPrompts(signal),
      (executor: any, signal: AbortSignal) => executor.getPrompt('dataset_guide', undefined, signal),
    ]) {
      let count = 0;
      let start!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      let upstream: AbortSignal | undefined;
      const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (++count === 1) return json(contract);
        upstream = init!.signal!;
        start();
        return new Promise<Response>((_resolve, reject) => upstream!.addEventListener('abort', () => reject(new Error('PRIVATE_CANCEL')), { once: true }));
      });
      const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
      const controller = new AbortController();
      const pending = call(executor, controller.signal);
      await started;
      controller.abort('PRIVATE_REASON');
      await expect(pending).rejects.toThrow();
      expect(upstream?.aborted).toBe(true);
    }
  });

  it('enforces deadlines across discovery and headers, even if a custom fetch never settles', async () => {
    let count = 0;
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (++count === 1) return json(contract);
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, executionBudget: { timeoutMs: 30 } });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_QUERY_TIMEOUT');
    expect(signal?.aborted).toBe(true);
  });

  it('bounds declared and streamed response bytes and cancels the reader', async () => {
    for (const declared of [false, true]) {
      const cancel = vi.fn();
      const fetchFn = backend(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1001)); }, cancel }), {
        headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': '1001' } : {}) },
      }));
      const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, executionBudget: { maxResponseBytes: 1000 } });
      expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_RESULT_TOO_LARGE');
      expect(cancel).toHaveBeenCalled();
    }
  });

  it('cancels a stalled response stream on deadline', async () => {
    const cancel = vi.fn();
    const fetchFn = backend(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel }), { headers: { 'content-type': 'application/json' } }));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, executionBudget: { timeoutMs: 30 } });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_QUERY_TIMEOUT');
    expect(cancel).toHaveBeenCalled();
  });

  it('refuses malformed, build, duplicate and oversized discovery contracts', async () => {
    for (const response of [json(source), json({ ...contract, contentHash: '0'.repeat(64) }),
      new Response('{"kind":1,"kind":2}', { headers: { 'content-type': 'application/json' } }),
      new Response(' '.repeat(200), { headers: { 'content-type': 'application/json', 'content-length': '2000000' } })]) {
      await expect(createMCPHttpExecutor({ url, fetchFn: vi.fn(async () => response) as typeof fetch })).rejects.toThrow();
    }
  });

  it('rejects invalid host configuration before network access and refuses an unservable default profile', async () => {
    const fetchFn = backend();
    for (const invalid of ['http://remote.test/contract', 'https://user:secret@remote.test/contract', 'https://remote.test/contract?token=secret', 'https://remote.test/contract#fragment']) {
      await expect(createMCPHttpExecutor({ url: invalid, fetchFn: fetchFn as typeof fetch })).rejects.toThrow();
    }
    await expect(createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, queryLimits: { maxResultSize: 0 } })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, queryLimits: { maxMeasures: 1 } })).rejects.toMatchObject({ code: 'MCP_CATALOG_TOO_LARGE' });
  });

  it('refuses oversized manifests rather than dropping targets', async () => {
    const fetchFn = backend();
    await expect(createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, catalogBudget: { maxManifestBytes: 100 } })).rejects.toMatchObject({ code: 'MCP_CATALOG_TOO_LARGE' });
  });

  it('never forwards credentials to a redirect origin with native fetch', async () => {
    let leakedRequests = 0;
    const other = createServer((_request, response) => { leakedRequests++; response.end('PRIVATE'); });
    const destination = await listen(other);
    const redirect = createServer((_request, response) => { response.writeHead(307, { location: destination }); response.end(); });
    const origin = await listen(redirect);
    try {
      await expect(createMCPHttpExecutor({ url: origin + '/contract', headers: { authorization: 'Bearer PRIVATE_TOKEN' } })).rejects.toMatchObject({ code: 'MCP_EXECUTION_FAILED' });
      expect(leakedRequests).toBe(0);
    } finally { await close(redirect); await close(other); }
  });

  it('serves actual MCP tools over the SDK in-memory transport and actual HTTP', async () => {
    const posts: { path: string; pin: string | string[] | undefined; body: unknown }[] = [];
    const backendServer = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') { response.end(JSON.stringify(contract)); return; }
      let text = '';
      for await (const chunk of request) text += chunk;
      posts.push({ path: request.url!, pin: request.headers['x-hypequery-client-schema'], body: JSON.parse(text) });
      const input = JSON.parse(text);
      response.end(JSON.stringify({ data: [{ revenue: '12' }], ...(input.includeMeta ? { meta: {
        requestId: 'one', timingMs: 1, rowCount: 1,
        pagination: { limit: input.limit, offset: input.offset, hasMore: false }, cache: { hit: true },
      } } : {}) }));
    });
    const origin = await listen(backendServer);
    const executor = await createMCPHttpExecutor({ url: origin + '/contract' });
    const server = new HypequeryMCPProtocolServer({ executor });
    const client = new Client({ name: 'http-bridge-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools).toHaveLength(4);
      const result = await client.callTool({ name: 'query_metric', arguments: { dataset: 'orders', metric: 'ordersRevenue' } });
      expect(result.structuredContent).toEqual({ data: [{ revenue: '12' }] });
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe('/api/v1/metrics/revenue');
      expect(posts[0].pin).toBe(contract.endpoints.find((endpoint: any) => endpoint.id === 'ordersRevenue').schemaHash);
      expect(posts[0].body).not.toHaveProperty('metric');
      const withMeta = await client.callTool({ name: 'query_metric', arguments: { dataset: 'orders', metric: 'ordersRevenue', includeMeta: true } });
      expect(withMeta.structuredContent).toMatchObject({ meta: { rowCount: 1, cache: { hit: true } } });
    } finally { await client.close(); await server.close(); await close(backendServer); }
  });

  it('publishes stricter configured limits while preserving backend endpoint pins', async () => {
    const fetchFn = backend();
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch, queryLimits: { maxResultSize: 2, maxOffset: 5 } });
    const manifest = await executor.listTools();
    expect(manifest._meta?.['com.hypequery/clientContractHash']).toBe(contract.contentHash);
    expect(executor.getManifestHash()).not.toBe(contract.contentHash);
    const profile = (await executor.callTool('get_dataset_schema', { dataset: 'orders' })).structuredContent as any;
    expect(profile.endpoints[0].limits).toMatchObject({ maxLimit: 2, defaultLimit: 2, maxOffset: 5 });
    await executor.callTool('query_dataset', { ...args, limit: 999 });
    const post = fetchFn.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]?.body as string).limit).toBe(2);
    expect(new Headers(post[1]?.headers).get('x-hypequery-client-schema')).toBe(contract.endpoints.find((endpoint: any) => endpoint.id === 'orders').schemaHash);
    const before = fetchFn.mock.calls.length;
    expect(code(await executor.callTool('query_dataset', { ...args, offset: 6 }))).toBe('MCP_INVALID_ARGUMENTS');
    expect(fetchFn).toHaveBeenCalledTimes(before);
  });

  it('never exposes an invalid successful backend response', async () => {
    for (const reply of [json({ ...rows, diagnostics: { sql: 'PRIVATE_SQL' } }),
      new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      new Response('PRIVATE_HTML', { headers: { 'content-type': 'text/html' } })]) {
      const fetchFn = backend(() => reply);
      const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
      const result = await executor.callTool('query_dataset', args);
      expect(code(result)).toBe('MCP_EXECUTION_FAILED');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });

  it('authorizes introspection and guides again instead of serving a cached principal view', async () => {
    let denied = false;
    const fetchFn = vi.fn(async () => denied ? json({ error: 'PRIVATE_DENIAL' }, 403) : json(contract));
    const executor = await createMCPHttpExecutor({ url, fetchFn: fetchFn as typeof fetch });
    const guide = await executor.getPrompt('dataset_guide', { dataset: 'orders' });
    expect(JSON.stringify(guide)).not.toMatch(/python.example|api\/v1|schemaHash/);
    denied = true;
    expect(code(await executor.callTool('get_dataset_schema', { dataset: 'orders' }))).toBe('MCP_UNAUTHORIZED');
    expect(code(await executor.callTool('list_datasets'))).toBe('MCP_UNAUTHORIZED');
    await expect(executor.listTools()).rejects.toMatchObject({ code: 'MCP_UNAUTHORIZED' });
    await expect(executor.listPrompts()).rejects.toMatchObject({ code: 'MCP_UNAUTHORIZED' });
    await expect(executor.getPrompt('dataset_guide')).rejects.toMatchObject({ code: 'MCP_UNAUTHORIZED' });
  });

  it('does not send a late request after a timed-out credential resolver settles', async () => {
    let release!: (headers: Record<string, string>) => void;
    let calls = 0;
    const fetchFn = backend();
    const headers = () => ++calls === 1 ? {} : new Promise<Record<string, string>>(resolve => { release = resolve; });
    const executor = await createMCPHttpExecutor({ url, headers, fetchFn: fetchFn as typeof fetch, executionBudget: { timeoutMs: 30 } });
    expect(code(await executor.callTool('query_dataset', args))).toBe('MCP_QUERY_TIMEOUT');
    release({ authorization: 'Bearer PRIVATE_LATE_TOKEN' });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('propagates SDK request cancellation through the server to a real HTTP socket', async () => {
    let postStarted!: () => void;
    let socketClosed!: () => void;
    const started = new Promise<void>(resolve => { postStarted = resolve; });
    const closed = new Promise<void>(resolve => { socketClosed = resolve; });
    const backendServer = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') { response.end(JSON.stringify(contract)); return; }
      response.on('close', socketClosed);
      response.write('{"data":[');
      postStarted();
    });
    const origin = await listen(backendServer);
    const executor = await createMCPHttpExecutor({ url: origin + '/contract' });
    const server = new HypequeryMCPProtocolServer({ executor });
    const client = new Client({ name: 'http-cancellation-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const controller = new AbortController();
      const request = client.callTool({ name: 'query_dataset', arguments: args }, undefined, { signal: controller.signal });
      const rejected = expect(request).rejects.toThrow();
      await started;
      controller.abort();
      await rejected;
      await closed;
    } finally { await client.close(); await server.close(); await close(backendServer); }
  });

});
