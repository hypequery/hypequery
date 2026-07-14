import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { DevAPIRouter, createDevRouter } from './router.js';
import { MemoryStore } from '../storage/index.js';
import type { DevIntegrationApi } from '../types.js';
import type { IncomingMessage, ServerResponse } from 'http';

class MockRequest extends EventEmitter {
  public url: string;
  public method: string;
  public headers: Record<string, string>;
  public socket = { remoteAddress: '127.0.0.1' };

  constructor(url = '/', method = 'GET', headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
  }

  sendBody(data: string) {
    this.emit('data', Buffer.from(data));
    this.emit('end');
  }
}

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';
  public ended = false;

  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }
  setHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  write(data: string): boolean {
    this.body += data;
    return true;
  }
  end(data?: string) {
    if (data) this.body += data;
    this.ended = true;
  }
  getBody<T>(): T {
    return JSON.parse(this.body) as T;
  }
}

/** Minimal DevIntegrationApi stub. */
function makeApi(overrides: Partial<DevIntegrationApi> = {}): DevIntegrationApi {
  return {
    queryLogger: { on: () => () => {} } as unknown as DevIntegrationApi['queryLogger'],
    describe: () => ({
      basePath: '/api',
      queries: [
        {
          key: 'listUsers',
          path: '/api/users',
          method: 'GET',
          name: 'List Users',
          tags: ['users'],
          visibility: 'public',
          requiresAuth: false,
          inputSchema: { type: 'object' },
          outputSchema: { type: 'array' }
        }
      ]
    }),
    execute: async () => ({ rows: [] }),
    ...overrides
  } as DevIntegrationApi;
}

const req = (url: string, method = 'GET', headers: Record<string, string> = {}) =>
  new MockRequest(url, method, headers) as unknown as IncomingMessage;
const res = () => new MockResponse() as unknown as ServerResponse;

describe('DevAPIRouter (gateway contract v0)', () => {
  let store: MemoryStore;
  let router: DevAPIRouter;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
    router = createDevRouter({
      store,
      api: makeApi(),
      capabilities: ['registry', 'execute', 'history', 'events'],
      projectName: 'demo'
    });
  });

  afterEach(() => router.shutdown());

  it('ignores non-dev routes', async () => {
    expect(await router.handleRequest(req('/api/users'), res())).toBe(false);
  });

  it('does not emit wildcard CORS for unknown origins', async () => {
    const r = res();
    await router.handleRequest(req('/__dev/meta', 'OPTIONS', { origin: 'https://evil.example' }), r);
    const mr = r as unknown as MockResponse;
    expect(mr.statusCode).toBe(204);
    expect(mr.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('GET /__dev/meta returns contract version + capabilities', async () => {
    const r = res();
    await router.handleRequest(req('/__dev/meta'), r);
    const body = (r as unknown as MockResponse).getBody<{
      contractVersion: string;
      capabilities: string[];
      project: { name: string };
    }>();
    expect(body.contractVersion).toBe('0.1');
    expect(body.capabilities).toContain('registry');
    expect(body.project.name).toBe('demo');
  });

  it('GET /__dev/registry maps describe() output', async () => {
    const r = res();
    await router.handleRequest(req('/__dev/registry'), r);
    const body = (r as unknown as MockResponse).getBody<{
      endpoints: Array<{ key: string; hasInput: boolean }>;
      total: number;
    }>();
    expect(body.total).toBe(1);
    expect(body.endpoints[0].key).toBe('listUsers');
    expect(body.endpoints[0].hasInput).toBe(true);
  });

  it('POST /__dev/execute runs the endpoint via the api', async () => {
    const r = res();
    const request = new MockRequest('/__dev/execute', 'POST');
    const done = router.handleRequest(request as unknown as IncomingMessage, r);
    request.sendBody(JSON.stringify({ key: 'listUsers', input: {} }));
    await done;
    const body = (r as unknown as MockResponse).getBody<{ success: boolean; key: string }>();
    expect(body.success).toBe(true);
    expect(body.key).toBe('listUsers');
  });

  it('POST /__dev/execute rejects a missing key', async () => {
    const r = res();
    const request = new MockRequest('/__dev/execute', 'POST');
    const done = router.handleRequest(request as unknown as IncomingMessage, r);
    request.sendBody(JSON.stringify({ input: {} }));
    await done;
    expect((r as unknown as MockResponse).statusCode).toBe(400);
  });

  it('GET /__dev/history lists persisted queries', async () => {
    await store.addQuery({
      queryId: 'q1',
      query: 'GET /api/users',
      startTime: Date.now(),
      status: 'completed'
    });
    const r = res();
    await router.handleRequest(req('/__dev/history'), r);
    const body = (r as unknown as MockResponse).getBody<{ total: number }>();
    expect(body.total).toBe(1);
  });

  it('serves 404 for unknown /__dev routes', async () => {
    const r = res();
    await router.handleRequest(req('/__dev/nope'), r);
    expect((r as unknown as MockResponse).statusCode).toBe(404);
  });

  describe('cache endpoints (contract v0)', () => {
    const makeObservability = (clearSupported = true) => ({
      getStats: async () => [
        { layer: 'semantic' as const, stats: { hits: 1, misses: 2 }, clearSupported }
      ],
      clear: async () => ({ cleared: clearSupported ? (['semantic'] as const) : [] })
    });

    it('GET /__dev/cache returns per-layer stats from cache observability', async () => {
      const withCache = createDevRouter({
        store,
        api: makeApi(),
        cacheObservability: makeObservability(),
        capabilities: ['cache', 'cache:clear'],
        projectName: 'demo'
      });
      const r = res();
      await withCache.handleRequest(req('/__dev/cache'), r);
      const body = (r as unknown as MockResponse).getBody<{ layers: Array<{ layer: string }> }>();
      expect(body.layers).toEqual([
        { layer: 'semantic', stats: { hits: 1, misses: 2 }, clearSupported: true }
      ]);
      await withCache.shutdown();
    });

    it('GET /__dev/cache falls back to a history-derived layer', async () => {
      const r = res();
      await router.handleRequest(req('/__dev/cache'), r);
      const body = (r as unknown as MockResponse).getBody<{
        layers: Array<{ layer: string; clearSupported: boolean }>;
      }>();
      expect(body.layers).toHaveLength(1);
      expect(body.layers[0].layer).toBe('history');
      expect(body.layers[0].clearSupported).toBe(false);
    });

    it('POST /__dev/cache/clear clears via observability and reports layer ids', async () => {
      const withCache = createDevRouter({
        store,
        api: makeApi(),
        cacheObservability: makeObservability(),
        capabilities: ['cache', 'cache:clear'],
        projectName: 'demo'
      });
      const r = res();
      const request = new MockRequest('/__dev/cache/clear', 'POST');
      const handled = withCache.handleRequest(request as unknown as IncomingMessage, r);
      request.sendBody('{}');
      await handled;
      const body = (r as unknown as MockResponse).getBody<{ cleared: string[] }>();
      expect(body.cleared).toEqual(['semantic']);
      await withCache.shutdown();
    });

    it('POST /__dev/cache/clear returns 503 when nothing can be cleared', async () => {
      const r = res();
      const request = new MockRequest('/__dev/cache/clear', 'POST');
      const handled = router.handleRequest(request as unknown as IncomingMessage, r);
      request.sendBody('{}');
      await handled;
      expect((r as unknown as MockResponse).statusCode).toBe(503);
    });
  });

  describe('execute context rejection (contract v0)', () => {
    it('rejects a context override with 400 context_not_allowed', async () => {
      const r = res();
      const request = new MockRequest('/__dev/execute', 'POST');
      const handled = router.handleRequest(request as unknown as IncomingMessage, r);
      request.sendBody(JSON.stringify({ key: 'listUsers', context: { tenantId: 't1' } }));
      await handled;
      const mr = r as unknown as MockResponse;
      expect(mr.statusCode).toBe(400);
      expect(mr.getBody<{ error: { type: string } }>().error.type).toBe('context_not_allowed');
    });
  });
});

