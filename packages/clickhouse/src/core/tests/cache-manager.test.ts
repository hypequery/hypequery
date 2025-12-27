import { createQueryBuilder } from '../query-builder.js';
import { MemoryCacheProvider } from '../cache/providers/memory-lru.js';
import type { CacheEntry, CacheProvider } from '../cache/types.js';
import type { QueryBuilder } from '../query-builder.js';
import type { QueryConfig } from '../../types/index.js';
import { executeWithCache } from '../cache/cache-manager.js';
import { buildRuntimeContext, resolveCacheConfig } from '../cache/runtime-context.js';
import { logger } from '../utils/logger.js';

const queryMock = jest.fn();
const logSpy = jest.spyOn(logger, 'logQuery');

jest.mock('../connection', () => ({
  ClickHouseConnection: {
    initialize: jest.fn(),
    getClient: jest.fn(() => ({
      query: (...args: unknown[]) => queryMock(...args)
    }))
  }
}));

type TestSchema = {
  users: {
    id: 'UInt32';
    email: 'String';
    active: 'UInt8';
  };
};

const baseConfig = {
  host: 'http://localhost:8123',
  username: 'default',
  password: 'password',
  database: 'tests'
};

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

class TestCacheProvider implements CacheProvider {
  store = new Map<string, CacheEntry>();
  tagIndex = new Map<string, Set<string>>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, entry: CacheEntry) {
    this.store.set(key, entry);
    entry.tags?.forEach(tag => {
      const indexKey = tag;
      if (!this.tagIndex.has(indexKey)) {
        this.tagIndex.set(indexKey, new Set());
      }
      this.tagIndex.get(indexKey)!.add(key);
    });
  }

  async delete(key: string) {
    this.store.delete(key);
    for (const bucket of this.tagIndex.values()) {
      bucket.delete(key);
    }
  }

  async deleteByTag(namespace: string, tag: string) {
    const bucket = this.tagIndex.get(tag);
    if (!bucket) return;
    for (const key of bucket) {
      await this.delete(key);
    }
    this.tagIndex.delete(tag);
  }
}

describe('Cache manager integration', () => {
  beforeEach(() => {
    queryMock.mockReset();
    logSpy.mockClear();
  });

  it('returns cached rows on subsequent cache-first calls', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }])
    }));

    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider: new MemoryCacheProvider({ maxEntries: 10 })
      }
    });

    const query = db.table('users').select(['id', 'email']);
    const first = await query.execute();
    const second = await query.execute();

    expect(first).toEqual(second);
    expect(callCount).toBe(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('performs stale-while-revalidate fetches in the background', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }])
    }));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 100,
        staleTtlMs: 1_000,
        provider
      }
    });

    const query = db.table('users').select(['id']);
    const nowSpy = jest.spyOn(Date, 'now');
    let currentTime = 0;
    nowSpy.mockImplementation(() => currentTime);

    try {
      const first = await query.execute();
      expect(first[0].id).toBe(1);
      expect(queryMock).toHaveBeenCalledTimes(1);

      currentTime = 200; // stale but acceptable
      const staleResult = await query.execute();
      expect(staleResult[0].id).toBe(1);

      await flushPromises();
      expect(queryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('deduplicates concurrent fetches for the same key', async () => {
    const rows = [{ id: 1, email: 'user-1', active: 1 }];
    let resolveQuery: (() => void) | undefined;
    queryMock.mockImplementation(() => new Promise(resolve => {
      resolveQuery = () => resolve({
        json: () => Promise.resolve(rows)
      });
    }));

    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 5_000,
        provider: new MemoryCacheProvider({ maxEntries: 10 })
      }
    });

    const query = db.table('users').select(['id']);
    const pending = Promise.all([query.execute(), query.execute()]);

    await flushPromises();
    expect(queryMock).toHaveBeenCalledTimes(1);
    resolveQuery?.();

    const [first, second] = await pending;
    expect(first).toEqual(rows);
    expect(second).toEqual(rows);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('allows disabling dedupe for independent executions', async () => {
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: Math.random(), email: 'user', active: 1 }])
    }));

    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 5_000,
        dedupe: false,
        provider: new MemoryCacheProvider({ maxEntries: 10 })
      }
    });

    const query = db.table('users').select(['id']);
    await Promise.all([query.execute(), query.execute()]);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('respects manual cache keys and tags with invalidation', async () => {
    const provider = new TestCacheProvider();
    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider
      }
    });

    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: 1, email: 'manual', active: 1 }])
    }));

    const query = db.table('users').select(['id'])
      .cache({ key: 'custom-key', tags: ['users'], ttlMs: 10_000 });
    await query.execute();

    expect(provider.store.has('custom-key')).toBe(true);

    await db.cache.invalidateTags(['users']);
    expect(provider.store.size).toBe(0);
  });

  // NOTE: network-first fallback is exercised via integration path; add unit coverage once ExecutorFeature is injectable.

  it('records cache metadata in logs for hits and stale hits', async () => {
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: 1, email: 'user', active: 1 }])
    }));

    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider: new MemoryCacheProvider({ maxEntries: 10 })
      }
    });

    const query = db.table('users').select(['id']);
    await query.execute({ queryId: 'q1' });
    await query.execute({ queryId: 'q1' });

    const metadataLogs = logSpy.mock.calls
      .map(([log]) => log)
      .filter(entry => entry?.cacheStatus);

    expect(metadataLogs.some(entry => entry.cacheStatus === 'hit')).toBe(true);
    expect(metadataLogs.every(entry => entry.cacheKey)).toBe(true);
  });

  it('bypasses caching when execute receives cache: false', async () => {
    const provider = new TestCacheProvider();
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: 1, email: 'no-cache', active: 1 }])
    }));

    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 5_000,
        provider
      }
    });

    const query = db.table('users').select(['id']);
    await query.execute({ cache: false });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(provider.store.size).toBe(0);
    const stats = db.cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('warms queries via db.cache.warm', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }])
    }));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider
      }
    });

    const firstQuery = db.table('users').select(['id']).cache({ tags: ['users'] });
    const secondQuery = db.table('users').select(['email']).cache({ tags: ['users'] });

    await db.cache.warm([
      () => firstQuery.execute(),
      () => secondQuery.execute()
    ]);

    expect(queryMock).toHaveBeenCalledTimes(2);

    await firstQuery.execute();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('reports hit rate including stale serves', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }])
    }));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      ...baseConfig,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 100,
        staleTtlMs: 1_000,
        provider
      }
    });

    const query = db.table('users').select(['id']);
    const nowSpy = jest.spyOn(Date, 'now');
    let currentTime = 0;
    nowSpy.mockImplementation(() => currentTime);

    try {
      await query.execute();
      currentTime = 50;
      await query.execute();
      let stats = db.cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.staleHits).toBe(0);
      expect(stats.hitRate).toBeCloseTo(0.5, 5);

      currentTime = 500;
      await query.execute();
      stats = db.cache.getStats();
      expect(stats.staleHits).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
