import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryCacheStore,
  SemanticQueryCache,
  type SemanticCacheEntry,
  type SemanticCacheStore,
} from './semantic-query-cache.js';

interface TestResult {
  data: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function makeRunner(results?: TestResult[]) {
  let calls = 0;
  const runner = vi.fn(async (): Promise<TestResult> => {
    const result = results?.[calls] ?? { data: [{ n: calls }], meta: { timingMs: 1 } };
    calls += 1;
    return structuredClone(result);
  });
  return runner;
}

describe('createMemoryCacheStore', () => {
  it('evicts least-recently-used entries beyond maxEntries', () => {
    const store = createMemoryCacheStore({ maxEntries: 2 });
    store.set('a', { value: 1, storedAt: 0 });
    store.set('b', { value: 2, storedAt: 0 });
    // Touch "a" so "b" becomes the eviction candidate.
    store.get('a');
    store.set('c', { value: 3, storedAt: 0 });

    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeUndefined();
    expect(store.get('c')).toBeDefined();
  });
});

describe('SemanticQueryCache.through', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs uncached when no TTL is configured anywhere', async () => {
    const cache = new SemanticQueryCache();
    const run = makeRunner();

    const first = await cache.through('k', run);
    const second = await cache.through('k', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(first.meta?.cache).toBeUndefined();
    expect(second.meta?.cache).toBeUndefined();
  });

  it('serves fresh hits within the TTL and annotates meta.cache', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner();

    const miss = await cache.through('k', run);
    vi.advanceTimersByTime(500);
    const hit = await cache.through('k', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(miss.meta?.cache).toEqual({ hit: false });
    expect(hit.meta?.cache).toEqual({ hit: true, ageMs: 500 });
    expect(hit.data).toEqual(miss.data);
  });

  it('re-executes after the TTL expires', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner();

    await cache.through('k', run);
    vi.advanceTimersByTime(1001);
    const result = await cache.through('k', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(result.meta?.cache).toEqual({ hit: false });
  });

  it('serves stale values inside the SWR window and refreshes in the background', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000, staleWhileRevalidateMs: 1000 });
    const run = makeRunner([
      { data: [{ v: 'first' }] },
      { data: [{ v: 'second' }] },
    ]);

    await cache.through('k', run);
    vi.advanceTimersByTime(1500);

    const stale = await cache.through('k', run);
    expect(stale.data).toEqual([{ v: 'first' }]);
    expect(stale.meta?.cache).toEqual({ hit: true, ageMs: 1500, stale: true });

    // Let the background refresh land, then the next call is a fresh hit.
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(2);

    const refreshed = await cache.through('k', run);
    expect(refreshed.data).toEqual([{ v: 'second' }]);
    expect(refreshed.meta?.cache).toMatchObject({ hit: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps the stale entry when a background refresh fails', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000, staleWhileRevalidateMs: 5000 });
    let calls = 0;
    const run = vi.fn(async (): Promise<TestResult> => {
      calls += 1;
      if (calls > 1) throw new Error('refresh boom');
      return { data: [{ v: 'first' }] };
    });

    await cache.through('k', run);
    vi.advanceTimersByTime(1500);
    const stale = await cache.through('k', run);
    await vi.runAllTimersAsync();

    expect(stale.data).toEqual([{ v: 'first' }]);
    // The failed refresh did not evict; still within SWR window → stale again.
    const staleAgain = await cache.through('k', run);
    expect(staleAgain.data).toEqual([{ v: 'first' }]);
  });

  it('bypass mode skips reads and writes', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner();

    await cache.through('k', run);
    const bypassed = await cache.through('k', run, { mode: 'bypass' });
    const hit = await cache.through('k', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(bypassed.meta?.cache).toBeUndefined();
    expect(hit.meta?.cache).toMatchObject({ hit: true });
  });

  it('`false` runtime disables the cache for the call', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner();

    await cache.through('k', run);
    const bypassed = await cache.through('k', run, false);

    expect(run).toHaveBeenCalledTimes(2);
    expect(bypassed.meta?.cache).toBeUndefined();
  });

  it('refresh mode skips the read but repopulates the entry', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner([
      { data: [{ v: 'first' }] },
      { data: [{ v: 'second' }] },
    ]);

    await cache.through('k', run);
    const refreshed = await cache.through('k', run, { mode: 'refresh' });
    const hit = await cache.through('k', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(refreshed.data).toEqual([{ v: 'second' }]);
    expect(hit.data).toEqual([{ v: 'second' }]);
    expect(hit.meta?.cache).toMatchObject({ hit: true });
  });

  it('refresh mode does not piggyback on an in-flight miss', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const resolvers: Array<(value: TestResult) => void> = [];
    const run = vi.fn(
      () => new Promise<TestResult>((resolve) => { resolvers.push(resolve); }),
    );

    const miss = cache.through('k', run);
    const refresh = cache.through('k', run, { mode: 'refresh' });
    expect(run).toHaveBeenCalledTimes(2);

    resolvers[0]({ data: [{ v: 'miss' }] });
    resolvers[1]({ data: [{ v: 'refresh' }] });

    expect((await miss).data).toEqual([{ v: 'miss' }]);
    expect((await refresh).data).toEqual([{ v: 'refresh' }]);
  });

  it('refresh mode without any TTL executes uncached and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cache = new SemanticQueryCache();
      const run = makeRunner();

      const result = await cache.through('k', run, { mode: 'refresh' });
      await cache.through('k', run, { mode: 'refresh' });

      expect(run).toHaveBeenCalledTimes(2);
      expect(result.meta?.cache).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/refresh.*no TTL/);
    } finally {
      warn.mockRestore();
    }
  });

  it('treats a failing store read as a miss', async () => {
    const store = createMemoryCacheStore();
    const failingStore: SemanticCacheStore = {
      ...store,
      get: vi.fn(async () => {
        throw new Error('store down');
      }),
    };
    const cache = new SemanticQueryCache({ ttlMs: 1000, store: failingStore });
    const run = makeRunner([{ data: [{ v: 'fresh' }] }]);

    const result = await cache.through('k', run);
    expect(result.data).toEqual([{ v: 'fresh' }]);
    expect(result.meta?.cache).toEqual({ hit: false });
  });

  it('returns the fresh result when the store write fails', async () => {
    const store = createMemoryCacheStore();
    const failingStore = {
      ...store,
      set: vi.fn(async () => {
        throw new Error('store down');
      }),
    };
    const cache = new SemanticQueryCache({ ttlMs: 1000, store: failingStore });
    const run = makeRunner([{ data: [{ v: 'fresh' }] }]);

    const result = await cache.through('k', run);
    expect(result.data).toEqual([{ v: 'fresh' }]);
    expect(failingStore.set).toHaveBeenCalled();
  });

  it('per-call TTL enables caching without client defaults', async () => {
    const cache = new SemanticQueryCache();
    const run = makeRunner();

    await cache.through('k', run, { ttlMs: 1000 });
    const hit = await cache.through('k', run, { ttlMs: 1000 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(hit.meta?.cache).toMatchObject({ hit: true });
  });

  it('deduplicates concurrent identical misses', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    let resolveRun!: (value: TestResult) => void;
    const run = vi.fn(
      () => new Promise<TestResult>((resolve) => { resolveRun = resolve; }),
    );

    const first = cache.through('k', run);
    const second = cache.through('k', run);
    resolveRun({ data: [{ v: 'shared' }] });

    const [a, b] = await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual([{ v: 'shared' }]);
    expect(b.data).toEqual([{ v: 'shared' }]);
    // Concurrent callers never share row objects — nor meta.cache objects.
    expect(a.data[0]).not.toBe(b.data[0]);
    expect(a.meta?.cache).not.toBe(b.meta?.cache);
  });

  it('dedupes concurrent misses through an async store', async () => {
    // Models a Redis-style store: the value is snapshotted when get() is
    // issued, and the response arrives only when the test releases it.
    const entries = new Map<string, SemanticCacheEntry>();
    const reads: Array<() => void> = [];
    const store: SemanticCacheStore = {
      get(key) {
        const snapshot = entries.get(key);
        return new Promise((resolve) => {
          reads.push(() => resolve(snapshot));
        });
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        entries.delete(key);
      },
    };
    const cache = new SemanticQueryCache({ ttlMs: 1000, store });
    const run = makeRunner();

    const first = cache.through('k', run);
    const second = cache.through('k', run);

    // Only the first caller reads the store; the second piggybacks on the
    // in-flight lookup instead of racing its own read against the write.
    expect(reads).toHaveLength(1);
    reads[0]();

    const [a, b] = await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
    expect(a.data[0]).not.toBe(b.data[0]);
  });

  it('piggybacked concurrent callers receive hit metadata when the lookup hits', async () => {
    const entries = new Map<string, SemanticCacheEntry>();
    const reads: Array<() => void> = [];
    const store: SemanticCacheStore = {
      get(key) {
        const snapshot = entries.get(key);
        return new Promise((resolve) => {
          reads.push(() => resolve(snapshot));
        });
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        entries.delete(key);
      },
    };
    const cache = new SemanticQueryCache({ ttlMs: 1000, store });
    const run = makeRunner();

    entries.set('k', { value: { data: [{ v: 'stored' }] }, storedAt: Date.now() });
    const first = cache.through('k', run);
    const second = cache.through('k', run);
    reads[0]();

    const [a, b] = await Promise.all([first, second]);
    expect(run).not.toHaveBeenCalled();
    expect(a.meta?.cache).toMatchObject({ hit: true });
    expect(b.meta?.cache).toMatchObject({ hit: true });
    expect(a.data[0]).not.toBe(b.data[0]);
  });

  it('does not cache errors', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    let calls = 0;
    const run = vi.fn(async (): Promise<TestResult> => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { data: [{ v: 'ok' }] };
    });

    await expect(cache.through('k', run)).rejects.toThrow('boom');
    const result = await cache.through('k', run);

    expect(result.data).toEqual([{ v: 'ok' }]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('isolates cached values from caller mutation', async () => {
    const cache = new SemanticQueryCache({ ttlMs: 1000 });
    const run = makeRunner([{ data: [{ v: 'original' }] }]);

    const first = await cache.through('k', run);
    (first.data[0] as Record<string, unknown>).v = 'mutated';

    const hit = await cache.through('k', run);
    expect(hit.data).toEqual([{ v: 'original' }]);
  });
});
