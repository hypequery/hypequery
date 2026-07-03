import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { DevAPIRouter, createDevRouter } from './router.js';
import { MemoryStore } from '../storage/index.js';
import type { IncomingMessage, ServerResponse } from 'http';

// Mock request
class MockRequest extends EventEmitter {
  public url: string;
  public method: string;
  public headers: Record<string, string>;

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

// Mock response
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

describe('DevAPIRouter', () => {
  let store: MemoryStore;
  let router: DevAPIRouter;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
    router = createDevRouter({ store });
  });

  afterEach(() => {
    router.shutdown();
  });

  describe('routing', () => {
    it('returns false for non-dev routes', async () => {
      const req = new MockRequest('/api/users') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(false);
    });

    it('handles CORS preflight', async () => {
      const req = new MockRequest('/__dev/queries', 'OPTIONS') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(204);
      expect(mockRes.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('sets CORS headers on all dev requests', async () => {
      const req = new MockRequest('/__dev/queries') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await router.handleRequest(req, res);

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('routes GET /__dev/queries', async () => {
      const req = new MockRequest('/__dev/queries') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.getBody<{ queries: unknown[] }>().queries).toBeDefined();
    });

    it('routes GET /__dev/queries/:id', async () => {
      await store.addQuery({
        queryId: 'test-123',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      const req = new MockRequest('/__dev/queries/test-123') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.getBody<{ queryId: string }>().queryId).toBe('test-123');
    });

    it('routes GET /__dev/queries/available', async () => {
      const req = new MockRequest('/__dev/queries/available') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
    });

    it('routes DELETE /__dev/queries', async () => {
      await store.addQuery({
        queryId: 'to-delete',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      const req = new MockRequest('/__dev/queries', 'DELETE') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
    });

    it('routes GET /__dev/cache/stats', async () => {
      const req = new MockRequest('/__dev/cache/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.getBody<{ hits: number }>().hits).toBeDefined();
    });

    it('routes GET /__dev/logger/stats', async () => {
      const req = new MockRequest('/__dev/logger/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(503); // Logger not available
    });

    it('routes GET /__dev/export', async () => {
      const req = new MockRequest('/__dev/export') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.headers['Content-Disposition']).toContain('attachment');
    });

    it('routes POST /__dev/import', async () => {
      const req = new MockRequest('/__dev/import', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = router.handleRequest(req, res);
      (req as unknown as MockRequest).sendBody('[]');
      const handled = await promise;

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
    });
  });

  describe('SSE events', () => {
    it('routes GET /__dev/events for SSE', async () => {
      const req = new MockRequest('/__dev/events') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
    });

    it('tracks SSE client count', async () => {
      expect(router.getClientCount()).toBe(0);

      const req = new MockRequest('/__dev/events') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await router.handleRequest(req, res);

      expect(router.getClientCount()).toBe(1);
    });

    it('provides SSE handler access', () => {
      const sseHandler = router.getSSEHandler();
      expect(sseHandler).toBeDefined();
      expect(typeof sseHandler.broadcast).toBe('function');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unmatched /__dev/* routes', async () => {
      const req = new MockRequest('/__dev/unknown') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const handled = await router.handleRequest(req, res);

      expect(handled).toBe(true);
      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(404);

      const body = mockRes.getBody<{ error: string; availableRoutes: string[] }>();
      expect(body.error).toBe('Not found');
      expect(body.availableRoutes).toBeInstanceOf(Array);
    });
  });

  describe('query string handling', () => {
    it('handles query parameters correctly', async () => {
      await store.batchInsert([
        { queryId: 'q1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' },
        { queryId: 'q2', query: 'SELECT 2', startTime: Date.now(), status: 'error' }
      ]);

      const req = new MockRequest('/__dev/queries?status=completed') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await router.handleRequest(req, res);

      const mockRes = res as unknown as MockResponse;
      const body = mockRes.getBody<{ queries: Array<{ status: string }>; total: number }>();
      expect(body.total).toBe(1);
      expect(body.queries[0].status).toBe('completed');
    });
  });

  describe('shutdown', () => {
    it('closes all SSE connections', async () => {
      const req1 = new MockRequest('/__dev/events') as unknown as IncomingMessage;
      const res1 = new MockResponse() as unknown as ServerResponse;
      const req2 = new MockRequest('/__dev/events') as unknown as IncomingMessage;
      const res2 = new MockResponse() as unknown as ServerResponse;

      await router.handleRequest(req1, res1);
      await router.handleRequest(req2, res2);

      expect(router.getClientCount()).toBe(2);

      router.shutdown();

      expect(router.getClientCount()).toBe(0);
    });
  });
});

describe('createDevRouter', () => {
  it('creates router with options', async () => {
    const store = new MemoryStore(1000);
    await store.initialize();

    const router = createDevRouter({
      store,
      cacheManager: {
        invalidate: async () => {},
        clear: async () => {}
      }
    });

    expect(router).toBeInstanceOf(DevAPIRouter);

    router.shutdown();
  });
});
