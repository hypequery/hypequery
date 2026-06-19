import { describe, expect, it, vi, afterEach } from 'vitest';

import { defineServe } from './server';
import { MemoryRateLimitStore, rateLimit, type RateLimitStore } from './rate-limit.js';
import type { EndpointContext, ServeRequest } from './types.js';

const stores: MemoryRateLimitStore[] = [];

const createStore = (cleanupIntervalMs = 60_000) => {
  const store = new MemoryRateLimitStore(cleanupIntervalMs);
  stores.push(store);
  return store;
};

const makeCtx = (overrides: Partial<EndpointContext> = {}) => ({
  request: { method: 'GET', path: '/x', query: {}, headers: {} },
  auth: null,
  locals: {},
  setCacheTtl: () => {},
  input: undefined,
  metadata: { path: '/api/test', method: 'GET', tags: [], visibility: 'public' },
  ...overrides,
}) as EndpointContext;

const createRequest = (overrides: Partial<ServeRequest> = {}): ServeRequest => ({
  method: 'GET',
  path: overrides.path ?? '/api/analytics/test',
  headers: {},
  query: {},
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) {
    store.destroy();
  }
});

describe('MemoryRateLimitStore', () => {
  it('increments counters within a window and resets after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const store = createStore();

    await expect(store.increment('key', 1000)).resolves.toBe(1);
    await expect(store.increment('key', 1000)).resolves.toBe(2);

    vi.advanceTimersByTime(1001);

    await expect(store.increment('key', 1000)).resolves.toBe(1);
  });

  it('reports ttl, clears keys, and destroy clears all entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const store = createStore();

    await store.increment('a', 1000);
    expect(await store.getTtl('a')).toBe(1000);

    vi.advanceTimersByTime(250);
    expect(await store.getTtl('a')).toBe(750);

    await store.reset('a');
    expect(await store.getTtl('a')).toBe(0);

    await store.increment('b', 1000);
    store.destroy();
    expect(await store.getTtl('b')).toBe(0);
  });
});

describe('rateLimit', () => {
  it('allows requests under the limit and exposes rate limit state on locals', async () => {
    const store = createStore();
    const middleware = rateLimit({ windowMs: 1000, max: 2, store });
    const ctx = makeCtx({ request: { method: 'GET', path: '/x', query: {}, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } } });
    const next = vi.fn(async () => ({ ok: true }));

    await expect(middleware(ctx, next)).resolves.toEqual({ ok: true });

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.locals._rateLimit).toEqual({ limit: 2, remaining: 1, resetMs: expect.any(Number) });
  });

  it('throws 429 with retry and limit headers when the limit is exceeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const store = createStore();
    const middleware = rateLimit({
      windowMs: 2000,
      max: 1,
      store,
      keyBy: () => 'user-1',
      message: 'Slow down',
    });
    const ctx = makeCtx();

    await middleware(ctx, async () => undefined);
    await expect(middleware(ctx, async () => undefined)).rejects.toMatchObject({
      message: 'Slow down',
      status: 429,
      headers: {
        'retry-after': '2',
        'x-ratelimit-limit': '1',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '2',
      },
      payload: {
        type: 'RATE_LIMITED',
        message: 'Slow down',
      },
    });
  });

  it('supports custom keys, null-key skip, and disabling limit headers', async () => {
    const store = createStore();
    const middleware = rateLimit({
      windowMs: 1000,
      max: 1,
      store,
      keyBy: (ctx) => ctx.auth?.userId as string | null,
      headers: false,
    });
    const skipped = makeCtx({ auth: {} as any });
    const limited = makeCtx({ auth: { userId: 'u1' } as any });
    const next = vi.fn(async () => 'ok');

    await expect(middleware(skipped, next)).resolves.toBe('ok');
    expect(skipped.locals._rateLimit).toBeUndefined();

    await middleware(limited, next);
    await expect(middleware(limited, next)).rejects.toMatchObject({
      status: 429,
      headers: {
        'retry-after': '1',
      },
    });

    await expect(middleware(limited, next)).rejects.not.toMatchObject({
      headers: {
        'x-ratelimit-limit': expect.any(String),
      },
    });
  });

  it('fails open by default when the store errors', async () => {
    const store: RateLimitStore = {
      increment: vi.fn(async () => {
        throw new Error('store down');
      }),
      getTtl: vi.fn(),
      reset: vi.fn(),
    };
    const middleware = rateLimit({ store });
    const next = vi.fn(async () => 'ok');

    await expect(middleware(makeCtx(), next)).resolves.toBe('ok');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws 503 when the store errors and failOpen is false', async () => {
    const store: RateLimitStore = {
      increment: vi.fn(async () => {
        throw new Error('store down');
      }),
      getTtl: vi.fn(),
      reset: vi.fn(),
    };
    const middleware = rateLimit({ store, failOpen: false });

    await expect(middleware(makeCtx(), async () => undefined)).rejects.toMatchObject({
      status: 503,
      payload: {
        type: 'SERVICE_UNAVAILABLE',
        message: 'Rate limiter unavailable',
      },
    });
  });

  it('returns a real 429 response through defineServe', async () => {
    const store = createStore();
    const api = defineServe({
      queries: {
        limited: {
          query: async () => ({ ok: true }),
        },
      },
      middlewares: [
        rateLimit({
          windowMs: 1000,
          max: 1,
          store,
          keyBy: () => 'client',
        }),
      ],
    });

    api.route('/test', api.queries.limited);

    const first = await api.handler(createRequest({ path: '/api/analytics/test' }));
    expect(first.status).toBe(200);

    const second = await api.handler(createRequest({ path: '/api/analytics/test' }));
    expect(second.status).toBe(429);
    expect(second.headers).toMatchObject({
      'retry-after': '1',
      'x-ratelimit-limit': '1',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1',
    });
    expect(second.body).toMatchObject({
      error: {
        type: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      },
    });
  });
});
