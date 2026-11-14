import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROWS, startFixtureServer, TENANT_TOOLS, THROTTLED, type FixtureServer } from '../../test/fixture-server.js';
import { createHypequeryToolsClient, toModelOutput } from './client.js';
import { HypequeryToolsError } from './errors.js';
import type { HypequeryToolResult, HypequeryToolsClient } from './types.js';

const TOKEN = 'agent-token-0123456789';
let server: FixtureServer;
const clients: HypequeryToolsClient[] = [];
function connect(options: Partial<Parameters<typeof createHypequeryToolsClient>[0]> = {}) {
  const client = createHypequeryToolsClient({ url: server.url, token: TOKEN, ...options });
  clients.push(client);
  return client;
}

beforeEach(async () => {
  server = await startFixtureServer(TOKEN);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await server.close();
});

describe('createHypequeryToolsClient', () => {
  it('lists the tenant tools with the schemas the server lists', async () => {
    const tools = await connect().listTools();
    const listed = await server.executor.listTools();
    expect(tools.map(tool => tool.name)).toEqual(TENANT_TOOLS);
    expect(tools.map(tool => tool.inputSchema)).toEqual(listed.tools.map(tool => tool.inputSchema));
    expect(tools.map(tool => tool.description)).toEqual(listed.tools.map(tool => tool.description ?? ''));
  });

  it('lists once per client', async () => {
    const spy = vi.spyOn(server.executor, 'listTools');
    const client = connect();
    await Promise.all([client.listTools(), client.listTools()]);
    await client.listTools();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token on every request', async () => {
    const client = connect();
    await client.listTools();
    await client.callTool('list_datasets', {});
    expect(server.authorizations.length).toBeGreaterThanOrEqual(3);
    expect(new Set(server.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]));
  });

  it('asks a token function before each request, so a refreshed token takes over', async () => {
    let current = TOKEN;
    const token = vi.fn(async () => current);
    const client = connect({ token });
    await client.listTools();
    const fresh = 'agent-token-refreshed-0123';
    server.validTokens.add(fresh);
    server.validTokens.delete(TOKEN);
    current = fresh;
    const result = await client.callTool('list_datasets', {});
    expect(result.ok).toBe(true);
    expect(server.authorizations.at(-1)).toBe(`Bearer ${fresh}`);
    expect(token.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('calls query_dataset and keeps the result request id', async () => {
    const onResult = vi.fn<(result: HypequeryToolResult) => void>();
    const client = connect({ onResult });
    const result = await client.callTool('query_dataset', {
      dataset: 'orders', dimensions: ['region'], measures: ['revenue'],
    });
    expect(result).toMatchObject({ ok: true, tool: 'query_dataset', requestId: expect.stringMatching(/^req_\d+$/) });
    expect(result.ok && result.data).toMatchObject({ data: ROWS });
    expect(toModelOutput(result)).toMatchObject({ data: ROWS });
    expect(onResult).toHaveBeenCalledWith(result);
  });

  it('returns a tool error with its envelope, hint and request id', async () => {
    const result = await connect().callTool('query_dataset', { dataset: 'throttled', measures: ['revenue'] });
    expect(result).toMatchObject({
      ok: false,
      requestId: THROTTLED.requestId,
      error: {
        code: THROTTLED.code,
        category: 'budget',
        message: THROTTLED.message,
        retryable: true,
        correctable: false,
        retryAfterSeconds: 30,
        hint: THROTTLED.hint,
        docsUrl: THROTTLED.docsUrl,
        requestId: THROTTLED.requestId,
      },
    });
    expect(toModelOutput(result)).toEqual({ error: !result.ok && result.error });
  });

  it('returns the server’s correctable errors, adding the result request id to the envelope', async () => {
    const direct = await server.executor.callTool('get_dataset_schema', { dataset: 'missing' });
    const result = await connect().callTool('get_dataset_schema', { dataset: 'missing' });
    expect(result.ok).toBe(false);
    expect(result.requestId).toMatch(/^req_\d+$/);
    expect(!result.ok && result.error).toEqual({
      ...(direct.structuredContent as { error: object }).error,
      requestId: result.requestId,
    });
  });

  it('throws HypequeryToolsError when the token is refused', async () => {
    const error = await connect({ token: 'wrong-token-0123456789' }).listTools().catch(caught => caught);
    expect(error).toBeInstanceOf(HypequeryToolsError);
    expect(error).toMatchObject({ code: 'MCP_UNAUTHORIZED', category: 'unauthorized', status: 401 });
  });

  it('keeps a refusal\u2019s retry delay, relist flag and reason on the thrown error', async () => {
    const refusal = {
      code: 'MCP_RATE_LIMITED',
      category: 'budget',
      message: 'Too many requests for this project',
      retryable: true,
      correctable: false,
      retryAfterSeconds: 30,
      relist: true,
      reason: 'HQ_PROJECT_QUOTA',
      hint: 'Wait 30 seconds.',
      requestId: 'req_refused',
    };
    const client = connect({
      fetch: async () => new Response(JSON.stringify({ error: refusal }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const error = await client.listTools().catch(caught => caught);
    expect(error).toBeInstanceOf(HypequeryToolsError);
    expect(error).toMatchObject({ ...refusal, status: 429 });
    expect((error as HypequeryToolsError).toJSON()).toEqual(refusal);
    expect(JSON.parse(JSON.stringify(error))).toEqual(refusal);
  });

  it('reuses one session, and opens a new one after the idle timeout', async () => {
    const client = connect({ idleTimeoutMs: 20 });
    await client.callTool('list_datasets', {});
    await client.callTool('list_datasets', {});
    expect(server.sessionsOpened()).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 60));
    const result = await client.callTool('list_datasets', {});
    expect(result.ok).toBe(true);
    expect(server.sessionsOpened()).toBe(2);
  });

  it('opens a new session once when the server has lost the old one', async () => {
    let loseNext = false;
    const client = connect({
      fetch: async (url, init) => {
        if (loseNext && init?.method === 'POST' && new Headers(init.headers).has('mcp-session-id')) {
          loseNext = false;
          return new Response('Session not found', { status: 404 });
        }
        return fetch(url, init);
      },
    });
    await client.callTool('list_datasets', {});
    loseNext = true;
    const result = await client.callTool('list_datasets', {});
    expect(result.ok).toBe(true);
    expect(server.sessionsOpened()).toBe(2);
  });

  it('does not call an empty token retryable', async () => {
    const error = await connect({ token: () => '  ' }).listTools().catch(caught => caught);
    expect(error).toBeInstanceOf(HypequeryToolsError);
    expect(error).toMatchObject({ code: 'MCP_UNAUTHORIZED', category: 'unauthorized', retryable: false });
    expect(server.authorizations).toEqual([]);
  });

  describe('an aborted call', () => {
    // An endpoint that accepts the connection and never answers.
    const release: Array<(reason: Error) => void> = [];
    let hang = false;
    const hanging: typeof fetch = (url, init) => (hang
      ? new Promise((_resolve, reject) => { release.push(reject); })
      : fetch(url, init));
    afterEach(() => {
      hang = false;
      for (const reject of release.splice(0)) reject(new Error('released'));
    });

    it('rejects with the signal\u2019s reason while the session is still opening', async () => {
      hang = true;
      const client = connect({ fetch: hanging });
      const listing = AbortSignal.timeout(20);
      const reason = await client.listTools({ signal: listing }).catch(caught => caught);
      expect(reason).toBe(listing.reason);
      expect(reason).toMatchObject({ name: 'TimeoutError' });
      const calling = new AbortController();
      const call = client.callTool('list_datasets', {}, { signal: calling.signal });
      calling.abort();
      await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects with the signal\u2019s reason during a tool call, and leaves the session usable', async () => {
      const client = connect({ fetch: hanging });
      await client.listTools();
      hang = true;
      const controller = new AbortController();
      const call = client.callTool('list_datasets', {}, { signal: controller.signal });
      controller.abort();
      await expect(call).rejects.toMatchObject({ name: 'AbortError' });
      hang = false;
      for (const reject of release.splice(0)) reject(new Error('released'));
      expect((await client.callTool('list_datasets', {})).ok).toBe(true);
    });

    it('does not fail another caller waiting on the same tool list', async () => {
      const client = connect();
      const controller = new AbortController();
      const aborted = client.listTools({ signal: controller.signal });
      const waiting = client.listTools();
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
      expect((await waiting).map(tool => tool.name)).toEqual(TENANT_TOOLS);
    });
  });

  it('rejects options without a usable token', () => {
    expect(() => createHypequeryToolsClient({ url: server.url, token: 42 as never })).toThrow(TypeError);
  });
});
