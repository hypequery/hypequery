import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  parseQueryParams,
  parseBody,
  sendJSON,
  sendError,
  getQueries,
  getQuery,
  getCacheStats,
  invalidateCache,
  clearCache,
  getAvailableQueries,
  getLoggerStats,
  clearHistory,
  type EndpointContext
} from './endpoints.js';
import { MemoryStore } from '../storage/index.js';
import type { IncomingMessage, ServerResponse } from 'http';

// Mock request
class MockRequest extends EventEmitter {
  public url: string;
  public method: string;

  constructor(url = '/', method = 'GET') {
    super();
    this.url = url;
    this.method = method;
  }

  // Simulate receiving body data
  sendBody(data: string) {
    this.emit('data', Buffer.from(data));
    this.emit('end');
  }
}

// Mock response
class MockResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';

  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }

  setHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  end(data?: string) {
    if (data) this.body = data;
  }

  getBody<T>(): T {
    return JSON.parse(this.body) as T;
  }
}

describe('Helper Functions', () => {
  describe('parseQueryParams', () => {
    it('parses query parameters', () => {
      const params = parseQueryParams('/path?foo=bar&baz=qux');
      expect(params).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('handles URL encoding', () => {
      const params = parseQueryParams('/path?name=hello%20world');
      expect(params).toEqual({ name: 'hello world' });
    });

    it('returns empty object for no params', () => {
      const params = parseQueryParams('/path');
      expect(params).toEqual({});
    });

    it('handles empty values', () => {
      const params = parseQueryParams('/path?empty=');
      expect(params).toEqual({ empty: '' });
    });
  });

  describe('parseBody', () => {
    it('parses JSON body', async () => {
      const req = new MockRequest() as unknown as IncomingMessage;
      const promise = parseBody(req);

      (req as unknown as MockRequest).sendBody('{"key":"value"}');

      const body = await promise;
      expect(body).toEqual({ key: 'value' });
    });

    it('returns empty object for empty body', async () => {
      const req = new MockRequest() as unknown as IncomingMessage;
      const promise = parseBody(req);

      (req as unknown as MockRequest).sendBody('');

      const body = await promise;
      expect(body).toEqual({});
    });

    it('throws on invalid JSON', async () => {
      const req = new MockRequest() as unknown as IncomingMessage;
      const promise = parseBody(req);

      (req as unknown as MockRequest).sendBody('not json');

      await expect(promise).rejects.toThrow('Invalid JSON');
    });
  });

  describe('sendJSON', () => {
    it('sends JSON response with status 200', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      sendJSON(res, { data: 'test' });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.headers['Content-Type']).toBe('application/json');
      expect(mockRes.getBody()).toEqual({ data: 'test' });
    });

    it('sends JSON response with custom status', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      sendJSON(res, { created: true }, 201);

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(201);
    });
  });

  describe('sendError', () => {
    it('sends error response with status 500', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      sendError(res, 'Something went wrong');

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(500);
      expect(mockRes.getBody()).toEqual({ error: 'Something went wrong' });
    });

    it('sends error response with custom status', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      sendError(res, 'Not found', 404);

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(404);
    });
  });
});

describe('Query Endpoints', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();

    // Add some test data
    await store.batchInsert([
      { queryId: 'q1', query: 'SELECT * FROM users', startTime: Date.now() - 3000, status: 'completed' },
      { queryId: 'q2', query: 'SELECT * FROM orders', startTime: Date.now() - 2000, status: 'completed' },
      { queryId: 'q3', query: 'SELECT * FROM products', startTime: Date.now() - 1000, status: 'error' }
    ]);
  });

  describe('getQueries', () => {
    it('returns paginated queries', async () => {
      const req = new MockRequest('/__dev/queries?limit=2') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ queries: unknown[]; total: number }>();
      expect(body.queries).toHaveLength(2);
      expect(body.total).toBe(3);
    });

    it('filters by status', async () => {
      const req = new MockRequest('/__dev/queries?status=error') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      const body = mockRes.getBody<{ queries: Array<{ status: string }>; total: number }>();
      expect(body.total).toBe(1);
      expect(body.queries[0].status).toBe('error');
    });

    it('searches query text', async () => {
      const req = new MockRequest('/__dev/queries?search=users') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      const body = mockRes.getBody<{ queries: Array<{ query: string }>; total: number }>();
      expect(body.total).toBe(1);
      expect(body.queries[0].query).toContain('users');
    });

    it('validates limit parameter', async () => {
      const req = new MockRequest('/__dev/queries?limit=0') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.getBody<{ error: string }>().error).toContain('limit');
    });

    it('validates offset parameter', async () => {
      const req = new MockRequest('/__dev/queries?offset=-1') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.getBody<{ error: string }>().error).toContain('offset');
    });

    it('validates status parameter', async () => {
      const req = new MockRequest('/__dev/queries?status=invalid') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.getBody<{ error: string }>().error).toContain('status');
    });
  });

  describe('getQuery', () => {
    it('returns query by ID', async () => {
      const req = new MockRequest('/__dev/queries/q1') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQuery({ store, req, res }, 'q1');

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ queryId: string }>();
      expect(body.queryId).toBe('q1');
    });

    it('returns 404 for missing query', async () => {
      const req = new MockRequest('/__dev/queries/nonexistent') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQuery({ store, req, res }, 'nonexistent');

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(404);
    });

    it('returns 400 for missing ID', async () => {
      const req = new MockRequest('/__dev/queries/') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getQuery({ store, req, res }, '');

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(400);
    });
  });
});

describe('Cache Endpoints', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
  });

  describe('getCacheStats', () => {
    it('returns cache statistics', async () => {
      // Add some cache data
      await store.batchInsert([
        { queryId: 'c1', query: 'SELECT 1', startTime: Date.now(), status: 'completed', cacheStatus: 'hit' },
        { queryId: 'c2', query: 'SELECT 2', startTime: Date.now(), status: 'completed', cacheStatus: 'miss' }
      ]);

      const req = new MockRequest('/__dev/cache/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getCacheStats({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ hits: number; misses: number; hitRate: number }>();
      expect(body.hits).toBe(1);
      expect(body.misses).toBe(1);
      expect(body.hitRate).toBe(0.5);
    });

    it('broadcasts stats to SSE', async () => {
      const sseHandler = {
        broadcast: vi.fn()
      };

      const req = new MockRequest('/__dev/cache/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getCacheStats({ store, req, res, sseHandler: sseHandler as any });

      expect(sseHandler.broadcast).toHaveBeenCalledWith({
        type: 'cache:stats',
        data: expect.any(Object)
      });
    });
  });

  describe('invalidateCache', () => {
    it('validates cacheKeys is array', async () => {
      const req = new MockRequest('/__dev/cache/invalidate', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = invalidateCache({ store, req, res });
      (req as unknown as MockRequest).sendBody('{"cacheKeys": "not-an-array"}');
      await promise;

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(400);
    });

    it('returns 503 when cache manager unavailable', async () => {
      const req = new MockRequest('/__dev/cache/invalidate', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = invalidateCache({ store, req, res });
      (req as unknown as MockRequest).sendBody('{"cacheKeys": ["key1"]}');
      await promise;

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(503);
    });

    it('invalidates cache keys', async () => {
      const cacheManager = {
        invalidate: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn()
      };

      const req = new MockRequest('/__dev/cache/invalidate', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = invalidateCache({ store, req, res, cacheManager });
      (req as unknown as MockRequest).sendBody('{"cacheKeys": ["key1", "key2"]}');
      await promise;

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(cacheManager.invalidate).toHaveBeenCalledTimes(2);

      const body = mockRes.getBody<{ invalidated: number }>();
      expect(body.invalidated).toBe(2);
    });
  });

  describe('clearCache', () => {
    it('returns 503 when cache manager unavailable', async () => {
      const req = new MockRequest('/__dev/cache/clear', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = clearCache({ store, req, res });
      (req as unknown as MockRequest).sendBody('{}');
      await promise;

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(503);
    });

    it('clears cache', async () => {
      const cacheManager = {
        invalidate: vi.fn(),
        clear: vi.fn().mockResolvedValue(undefined)
      };

      const req = new MockRequest('/__dev/cache/clear', 'POST') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      const promise = clearCache({ store, req, res, cacheManager });
      (req as unknown as MockRequest).sendBody('{}');
      await promise;

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);
      expect(cacheManager.clear).toHaveBeenCalled();

      const body = mockRes.getBody<{ cleared: boolean }>();
      expect(body.cleared).toBe(true);
    });
  });
});

describe('Discovery Endpoints', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
  });

  describe('getAvailableQueries', () => {
    it('returns empty array when no API', async () => {
      const req = new MockRequest('/__dev/queries/available') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getAvailableQueries({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ queries: unknown[]; total: number }>();
      expect(body.queries).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns available endpoints', async () => {
      const api = {
        endpoints: {
          getUsers: { path: '/users', method: 'GET', description: 'Get users' },
          createOrder: { path: '/orders', method: 'POST', tags: ['orders'] }
        }
      };

      const req = new MockRequest('/__dev/queries/available') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getAvailableQueries({ store, req, res, api });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ queries: Array<{ key: string; path: string }>; total: number }>();
      expect(body.total).toBe(2);
      expect(body.queries.find(q => q.key === 'getUsers')).toBeDefined();
    });
  });

  describe('getLoggerStats', () => {
    it('returns 503 when logger unavailable', async () => {
      const req = new MockRequest('/__dev/logger/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getLoggerStats({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(503);
    });

    it('returns logger stats', async () => {
      const logger = {
        getStats: vi.fn().mockReturnValue({
          totalLogged: 100,
          persisted: 95,
          failed: 5,
          queueSize: 0,
          flushCount: 10,
          avgBatchSize: 10
        })
      };

      const req = new MockRequest('/__dev/logger/stats') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await getLoggerStats({ store, req, res, logger: logger as any });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const body = mockRes.getBody<{ totalLogged: number }>();
      expect(body.totalLogged).toBe(100);
    });
  });
});

describe('History Management Endpoints', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();

    await store.batchInsert([
      { queryId: 'q1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' }
    ]);
  });

  describe('clearHistory', () => {
    it('clears all history', async () => {
      const req = new MockRequest('/__dev/queries', 'DELETE') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await clearHistory({ store, req, res });

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.statusCode).toBe(200);

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
    });

    it('broadcasts clear event', async () => {
      const sseHandler = {
        broadcast: vi.fn()
      };

      const req = new MockRequest('/__dev/queries', 'DELETE') as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await clearHistory({ store, req, res, sseHandler: sseHandler as any });

      expect(sseHandler.broadcast).toHaveBeenCalledWith({
        type: 'history:cleared',
        data: expect.objectContaining({ cleared: true })
      });
    });
  });
});
