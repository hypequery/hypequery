import { describe, expect, it, vi } from 'vitest';
import { checkRemoteMcp } from './mcp-remote-check.js';

const URL_ = 'https://cloud.example.test/api/gateway/p/production/mcp';

function hostedMcp(overrides: { initStatus?: number; listStatus?: number; protocolVersion?: string } = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const message = JSON.parse(init.body as string);
    if (message.method === 'initialize') {
      return Response.json(
        { jsonrpc: '2.0', id: 1, result: { protocolVersion: overrides.protocolVersion ?? '2025-06-18', serverInfo: { name: 'hypequery' } } },
        { status: overrides.initStatus ?? 200, headers: { 'mcp-session-id': 'session-1' } },
      );
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json(
      { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'list_datasets' }, { name: 'query_dataset' }] } },
      { status: overrides.listStatus ?? 200 },
    );
  });
}

describe('remote MCP self-test', () => {
  it('initializes and lists tools without calling any', async () => {
    const fetch = hostedMcp();

    await expect(checkRemoteMcp({ url: URL_, key: 'hq_key', fetch: fetch as never }))
      .resolves.toEqual({ ok: true, tools: 2, server: 'hypequery' });

    const methods = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).method);
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    const headers = fetch.mock.calls[2]![1].headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer hq_key');
    expect(headers['mcp-session-id']).toBe('session-1');
  });

  it('accepts SSE for both initialize and tools/list', async () => {
    const jsonFetch = hostedMcp();
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const response = await jsonFetch(url, init);
      if (response.status === 202) return response;
      const body = await response.text();
      return new Response(`: keepalive\n\ndata: ${body}\n\n`, {
        headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1' },
      });
    });

    await expect(checkRemoteMcp({ url: URL_, key: 'hq_key', fetch: fetch as never }))
      .resolves.toEqual({ ok: true, tools: 2, server: 'hypequery' });
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).method))
      .toEqual(['initialize', 'notifications/initialized', 'tools/list']);
  });

  it.each(['2025-03-26', '2025-11-25'])('uses the negotiated version %s after initialization', async protocolVersion => {
    const fetch = hostedMcp({ protocolVersion });

    await expect(checkRemoteMcp({ url: URL_, key: 'hq_key', fetch: fetch as never }))
      .resolves.toMatchObject({ ok: true });
    for (const [, init] of fetch.mock.calls.slice(1)) {
      expect(init.headers).toMatchObject({
        'mcp-protocol-version': protocolVersion,
        'mcp-session-id': 'session-1',
      });
    }
  });

  it('stops when the negotiated version is unsupported', async () => {
    const fetch = hostedMcp({ protocolVersion: '2099-01-01' });

    await expect(checkRemoteMcp({ url: URL_, key: 'hq_key', fetch: fetch as never }))
      .resolves.toEqual({ ok: false, reason: 'initialize returned an unsupported protocol version.' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('explains a refused key', async () => {
    await expect(checkRemoteMcp({ url: URL_, key: 'bad', fetch: hostedMcp({ initStatus: 401 }) as never }))
      .resolves.toEqual({ ok: false, reason: expect.stringContaining('401') });
  });

  it('refuses to send the key over plain http to a remote host', async () => {
    const fetch = vi.fn();

    await expect(checkRemoteMcp({ url: 'http://cloud.example.test/mcp', key: 'hq_key', fetch }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('https') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an unreachable endpoint without leaking the key', async () => {
    const result = await checkRemoteMcp({
      url: URL_,
      key: 'hq_key',
      fetch: vi.fn(async () => { throw new TypeError('fetch failed'); }) as never,
    });

    expect(result).toEqual({ ok: false, reason: 'the endpoint could not be reached.' });
    expect(JSON.stringify(result)).not.toContain('hq_key');
  });
});
