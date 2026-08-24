import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import { createQueryBuilder } from '../query-builder.js';
import { MemoryCacheProvider } from '../cache/providers/memory-lru.js';
import type { CacheEntry, CacheProvider } from '../cache/types.js';
import { logger } from '../utils/logger.js';
import { substituteParameters } from '../utils.js';

const queryMock = vi.fn();
const logSpy = vi.spyOn(logger, 'logQuery');

const testAdapter: DatabaseAdapter = {
  name: 'test',
  query: (sql, params = []) => queryMock(sql, params),
  render: (sql, params = []) => substituteParameters(sql, params)
};

type TestSchema = {
  users: {
    id: 'UInt32';
    email: 'String';
    active: 'UInt8';
  };
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
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 100,
        staleTtlMs: 1_000,
        provider
      }
    });

    const query = db.table('users').select(['id']);
    const nowSpy = vi.spyOn(Date, 'now');
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
      resolveQuery = () => resolve(rows);
    }));

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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
    queryMock.mockResolvedValue([{ id: Math.random(), email: 'user', active: 1 }]);

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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
      adapter: testAdapter,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider
      }
    });

    queryMock.mockResolvedValue([{ id: 1, email: 'manual', active: 1 }]);

    const query = db.table('users').select(['id'])
      .cache({ key: 'custom-key', tags: ['users'], ttlMs: 10_000 });
    await query.execute();

    expect(provider.store.has('custom-key')).toBe(true);

    await db.cache.invalidateTags(['users']);
    expect(provider.store.size).toBe(0);
  });

  it('defaults cacheTimeMs to ttl + staleTtl when not explicitly provided', async () => {
    const provider = new TestCacheProvider();
    queryMock.mockResolvedValue([{ id: 1, email: 'ttl', active: 1 }]);

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 0,
        staleTtlMs: 0,
        provider
      }
    });

    await db.table('users')
      .select(['id'])
      .cache({ ttlMs: 200, staleTtlMs: 800 })
      .execute();

    const [entry] = Array.from(provider.store.values());
    expect(entry?.cacheTimeMs).toBe(1000);
  });

  it('invalidates tags for memory cache providers when namespaces include protocol prefixes', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
      cache: {
        namespace: 'http://localhost:8123',
        mode: 'cache-first',
        ttlMs: 10_000,
        provider
      }
    });

    const runQuery = () => db
      .table('users')
      .select(['id'])
      .cache({ tags: ['users'], ttlMs: 10_000 })
      .execute();

    await runQuery();
    await runQuery();
    expect(callCount).toBe(1);

    await db.cache.invalidateTags(['users']);

    await runQuery();
    expect(callCount).toBe(2);
  });

  // NOTE: network-first fallback is exercised via integration path; add unit coverage once ExecutorFeature is injectable.

  it('records cache metadata in logs for hits and stale hits', async () => {
    queryMock.mockResolvedValue([{ id: 1, email: 'user', active: 1 }]);

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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
    queryMock.mockResolvedValue([{ id: 1, email: 'no-cache', active: 1 }]);

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
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

  it('uses transformed query settings when computing cache keys', async () => {
    const provider = new TestCacheProvider();
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider
      }
    });

    const base = db.table('users').select(['id']);
    const fastQuery = base.cache({ ttlMs: 10_000 });
    (fastQuery as any).queryTransforms.push((query: any) => ({
      ...query,
      settings: { max_execution_time: 10 },
    }));

    const slowQuery = base.cache({ ttlMs: 10_000 });
    (slowQuery as any).queryTransforms.push((query: any) => ({
      ...query,
      settings: { max_execution_time: 20 },
    }));

    await fastQuery.execute();
    await slowQuery.execute();

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(provider.store.size).toBe(2);
  });

  it('reports hit rate including stale serves', async () => {
    let callCount = 0;
    queryMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const provider = new MemoryCacheProvider({ maxEntries: 10 });
    const db = createQueryBuilder<TestSchema>({
      adapter: testAdapter,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 100,
        staleTtlMs: 1_000,
        provider
      }
    });

    const query = db.table('users').select(['id']);
    const nowSpy = vi.spyOn(Date, 'now');
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

describe('Cache manager abort signals', () => {
  const signalMock = vi.fn();
  const signalAdapter: DatabaseAdapter = {
    name: 'test',
    query: (sql, params = [], options) => signalMock(sql, params, options?.abortSignal),
    render: (sql, params = []) => substituteParameters(sql, params)
  };
  const observedSignal = (call: number): AbortSignal => signalMock.mock.calls[call][2];

  const cachedBuilder = (mode: 'cache-first' | 'network-first' = 'cache-first') =>
    createQueryBuilder<TestSchema>({
      adapter: signalAdapter,
      cache: {
        mode,
        ttlMs: 100,
        staleTtlMs: 1_000,
        staleIfError: true,
        provider: new MemoryCacheProvider({ maxEntries: 10 })
      }
    });

  const rows = [{ id: 1, email: 'user-1', active: 1 }];

  beforeEach(() => {
    signalMock.mockReset();
  });

  it('shares one fetch between abortable and plain callers', async () => {
    let resolveQuery: (() => void) | undefined;
    signalMock.mockImplementation(() => new Promise(resolve => {
      resolveQuery = () => resolve(rows);
    }));

    const query = cachedBuilder().table('users').select(['id']);
    const controller = new AbortController();
    const pending = Promise.all([query.execute(), query.execute({ abortSignal: controller.signal })]);

    await flushPromises();
    expect(signalMock).toHaveBeenCalledTimes(1);

    resolveQuery?.();
    expect(await pending).toEqual([rows, rows]);
  });

  it('keeps the shared fetch running while another caller still waits', async () => {
    let resolveQuery: (() => void) | undefined;
    signalMock.mockImplementation(() => new Promise(resolve => {
      resolveQuery = () => resolve(rows);
    }));

    const query = cachedBuilder().table('users').select(['id']);
    const controller = new AbortController();
    const waiting = query.execute();
    const abortable = query.execute({ abortSignal: controller.signal });
    await flushPromises();

    controller.abort(new Error('caller went away'));
    await expect(abortable).rejects.toThrow('caller went away');
    expect(observedSignal(0).aborted).toBe(false);

    resolveQuery?.();
    expect(await waiting).toEqual(rows);
  });

  it('cancels the shared fetch once every waiter aborts', async () => {
    signalMock.mockImplementation((_sql: string, _params: unknown[], abortSignal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new Error('aborted upstream')));
      }));

    const query = cachedBuilder().table('users').select(['id']);
    const first = new AbortController();
    const second = new AbortController();
    const pending = [
      query.execute({ abortSignal: first.signal }).catch(error => error),
      query.execute({ abortSignal: second.signal }).catch(error => error)
    ];
    await flushPromises();

    first.abort(new Error('first gone'));
    expect(observedSignal(0).aborted).toBe(false);

    second.abort(new Error('second gone'));
    expect(observedSignal(0).aborted).toBe(true);

    const [firstError, secondError] = await Promise.all(pending);
    expect(firstError.message).toBe('first gone');
    expect(secondError.message).toBe('second gone');
  });

  it('starts a fresh fetch for callers arriving after the shared fetch was cancelled', async () => {
    let calls = 0;
    let cancelledFetchSettled: (() => void) | undefined;
    const cancelledFetch = new Promise<void>(resolve => {
      cancelledFetchSettled = resolve;
    });
    signalMock.mockImplementation((_sql: string, _params: unknown[], abortSignal?: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => {
            setTimeout(() => {
              reject(new Error('aborted upstream'));
              cancelledFetchSettled?.();
            }, 0);
          });
        });
      }
      return Promise.resolve(rows);
    });

    const query = cachedBuilder().table('users').select(['id']);
    const first = new AbortController();
    const second = new AbortController();
    const pending = [
      query.execute({ abortSignal: first.signal }).catch(error => error),
      query.execute({ abortSignal: second.signal }).catch(error => error)
    ];
    await flushPromises();

    first.abort(new Error('first gone'));
    second.abort(new Error('second gone'));

    const fresh = query.execute();

    expect(await fresh).toEqual(rows);
    expect(signalMock).toHaveBeenCalledTimes(2);
    await Promise.all(pending);
    await cancelledFetch;
    await flushPromises();
  });

  it('runs background revalidation beyond the aborting caller', async () => {
    let callCount = 0;
    signalMock.mockImplementation(() => Promise.resolve([{ id: ++callCount, email: `user-${callCount}`, active: 1 }]));

    const query = cachedBuilder('cache-first').table('users').select(['id']);
    const nowSpy = vi.spyOn(Date, 'now');
    let currentTime = 0;
    nowSpy.mockImplementation(() => currentTime);

    try {
      await query.execute();

      currentTime = 200;
      const controller = new AbortController();
      await query.execute({ abortSignal: controller.signal });
      controller.abort(new Error('caller went away'));

      await flushPromises();
      expect(signalMock).toHaveBeenCalledTimes(2);
      expect(observedSignal(1).aborted).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('rejects a pre-aborted sole caller without fetching or writing the cache', async () => {
    signalMock.mockImplementation(() => Promise.resolve(rows));

    const query = cachedBuilder().table('users').select(['id']);
    const controller = new AbortController();
    controller.abort(new Error('caller went away'));

    await expect(query.execute({ abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(signalMock).not.toHaveBeenCalled();

    // The cache must not have been populated by the aborted execution.
    expect(await query.execute()).toEqual(rows);
    expect(signalMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a pre-aborted caller even when a fresh cache entry exists', async () => {
    signalMock.mockImplementation(() => Promise.resolve(rows));

    const query = cachedBuilder().table('users').select(['id']);
    await query.execute();

    const controller = new AbortController();
    controller.abort(new Error('caller went away'));

    await expect(query.execute({ abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(signalMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when the caller aborts during an asynchronous cache lookup', async () => {
    const reason = new Error('caller went away');
    let startLookup: (() => void) | undefined;
    const lookupStarted = new Promise<void>(resolve => {
      startLookup = resolve;
    });
    let finishLookup: ((entry: CacheEntry) => void) | undefined;
    const provider: CacheProvider = {
      get: vi.fn(() => {
        startLookup?.();
        return new Promise<CacheEntry>(resolve => {
          finishLookup = resolve;
        });
      }),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const db = createQueryBuilder<TestSchema>({
      adapter: signalAdapter,
      cache: {
        mode: 'cache-first',
        ttlMs: 1_000,
        provider,
      },
    });
    const query = db.table('users').select(['id']);
    const controller = new AbortController();

    const pending = query.execute({ abortSignal: controller.signal });
    await lookupStarted;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);

    // Let the non-abortable provider operation settle so the test leaves no work behind.
    finishLookup?.({
      value: JSON.stringify(rows),
      createdAt: Date.now(),
      ttlMs: 1_000,
      staleTtlMs: 0,
      cacheTimeMs: 1_000,
      rowCount: rows.length,
    });
    await flushPromises();
    expect(signalMock).not.toHaveBeenCalled();
  });

  it('writes replacement rows after an abandoned cache write settles', async () => {
    const oldRows = [{ id: 1, email: 'old', active: 1 }];
    const replacementRows = [{ id: 2, email: 'replacement', active: 1 }];
    signalMock
      .mockResolvedValueOnce(oldRows)
      .mockResolvedValueOnce(replacementRows);

    const store = new Map<string, CacheEntry>();
    let setCalls = 0;
    let releaseFirstWrite: (() => void) | undefined;
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve;
    });
    const provider: CacheProvider = {
      get: vi.fn(async key => store.get(key) ?? null),
      set: vi.fn(async (key, entry) => {
        setCalls += 1;
        if (setCalls === 1) {
          markFirstWriteStarted?.();
          await new Promise<void>(resolve => {
            releaseFirstWrite = resolve;
          });
        }
        store.set(key, entry);
      }),
      delete: vi.fn(async key => {
        store.delete(key);
      }),
    };
    const db = createQueryBuilder<TestSchema>({
      adapter: signalAdapter,
      cache: {
        mode: 'cache-first',
        ttlMs: 1_000,
        provider,
      },
    });
    const query = db.table('users').select(['id']);
    const controller = new AbortController();

    const abandoned = query.execute({ abortSignal: controller.signal });
    await firstWriteStarted;
    controller.abort(new Error('first caller left'));
    await expect(abandoned).rejects.toThrow('first caller left');

    const replacement = query.execute();
    await flushPromises();
    expect(signalMock).toHaveBeenCalledTimes(2);
    expect(setCalls).toBe(1);

    releaseFirstWrite?.();

    await expect(replacement).resolves.toEqual(replacementRows);
    expect(setCalls).toBe(2);
    await expect(query.execute()).resolves.toEqual(replacementRows);
    expect(signalMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an aborted network-first execution instead of serving stale rows', async () => {
    let callCount = 0;
    signalMock.mockImplementation((_sql: string, _params: unknown[], abortSignal?: AbortSignal) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve([{ id: 1, email: 'cached', active: 1 }]);
      }
      return new Promise((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new Error('aborted upstream')));
      });
    });

    const query = cachedBuilder('network-first').table('users').select(['id']);
    const nowSpy = vi.spyOn(Date, 'now');
    let currentTime = 0;
    nowSpy.mockImplementation(() => currentTime);

    try {
      await query.execute();

      currentTime = 200;
      const controller = new AbortController();
      const pending = query.execute({ abortSignal: controller.signal });
      await flushPromises();
      controller.abort(new Error('caller went away'));

      await expect(pending).rejects.toThrow('caller went away');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
