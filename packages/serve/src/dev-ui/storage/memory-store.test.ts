import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(100);
    await store.initialize();
  });

  describe('initialize', () => {
    it('initializes without error', async () => {
      const newStore = new MemoryStore();
      await expect(newStore.initialize()).resolves.not.toThrow();
    });
  });

  describe('addQuery', () => {
    it('inserts single row', async () => {
      const log = {
        queryId: 'test-1',
        query: 'SELECT * FROM users',
        parameters: [1, 'test'],
        startTime: Date.now(),
        status: 'completed' as const,
        duration: 100,
        rowCount: 10
      };

      await store.addQuery(log);

      const result = await store.getQuery('test-1');
      expect(result).not.toBeNull();
      expect(result?.query).toBe('SELECT * FROM users');
      expect(result?.parameters).toEqual([1, 'test']);
      expect(result?.duration).toBe(100);
      expect(result?.rowCount).toBe(10);
    });

    it('updates existing entry with same queryId', async () => {
      const log1 = {
        queryId: 'dup-1',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'started' as const
      };
      const log2 = {
        queryId: 'dup-1',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed' as const,
        duration: 100
      };

      await store.addQuery(log1);
      await store.addQuery(log2);

      expect(store.size).toBe(1);
      const result = await store.getQuery('dup-1');
      expect(result?.status).toBe('completed');
      expect(result?.duration).toBe(100);
    });

    it('handles queries with errors', async () => {
      const log = {
        queryId: 'error-query',
        query: 'SELECT * FROM nonexistent',
        startTime: Date.now(),
        status: 'error' as const,
        error: new Error('Table not found')
      };

      await store.addQuery(log);

      const result = await store.getQuery('error-query');
      expect(result?.status).toBe('error');
      expect(result?.error?.message).toBe('Table not found');
    });

    it('handles queries with cache metadata', async () => {
      const log = {
        queryId: 'cached-query',
        query: 'SELECT * FROM metrics',
        startTime: Date.now(),
        status: 'completed' as const,
        cacheStatus: 'hit' as const,
        cacheKey: 'metrics-key',
        cacheMode: 'force-cache',
        cacheAgeMs: 5000
      };

      await store.addQuery(log);

      const result = await store.getQuery('cached-query');
      expect(result?.cacheStatus).toBe('hit');
      expect(result?.cacheKey).toBe('metrics-key');
      expect(result?.cacheMode).toBe('force-cache');
      expect(result?.cacheAgeMs).toBe(5000);
    });
  });

  describe('batchInsert', () => {
    it('inserts multiple rows', async () => {
      const logs = [
        { queryId: 'batch-1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' as const },
        { queryId: 'batch-2', query: 'SELECT 2', startTime: Date.now() + 1, status: 'completed' as const },
        { queryId: 'batch-3', query: 'SELECT 3', startTime: Date.now() + 2, status: 'completed' as const }
      ];

      await store.batchInsert(logs);

      const result = await store.getQueries({});
      expect(result.total).toBe(3);
    });

    it('handles empty array', async () => {
      await store.batchInsert([]);

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
    });
  });

  describe('FIFO eviction', () => {
    it('evicts oldest entries when limit reached', async () => {
      const smallStore = new MemoryStore(3);
      await smallStore.initialize();

      await smallStore.addQuery({ queryId: 'q1', query: 'SELECT 1', startTime: 1000, status: 'completed' as const });
      await smallStore.addQuery({ queryId: 'q2', query: 'SELECT 2', startTime: 2000, status: 'completed' as const });
      await smallStore.addQuery({ queryId: 'q3', query: 'SELECT 3', startTime: 3000, status: 'completed' as const });

      expect(smallStore.size).toBe(3);

      // Add a 4th query, should evict q1
      await smallStore.addQuery({ queryId: 'q4', query: 'SELECT 4', startTime: 4000, status: 'completed' as const });

      expect(smallStore.size).toBe(3);
      expect(await smallStore.getQuery('q1')).toBeNull(); // Evicted
      expect(await smallStore.getQuery('q2')).not.toBeNull();
      expect(await smallStore.getQuery('q3')).not.toBeNull();
      expect(await smallStore.getQuery('q4')).not.toBeNull();
    });

    it('does not evict when updating existing entry', async () => {
      const smallStore = new MemoryStore(3);
      await smallStore.initialize();

      await smallStore.addQuery({ queryId: 'q1', query: 'SELECT 1', startTime: 1000, status: 'started' as const });
      await smallStore.addQuery({ queryId: 'q2', query: 'SELECT 2', startTime: 2000, status: 'completed' as const });
      await smallStore.addQuery({ queryId: 'q3', query: 'SELECT 3', startTime: 3000, status: 'completed' as const });

      // Update q1, should not evict anything
      await smallStore.addQuery({ queryId: 'q1', query: 'SELECT 1', startTime: 1000, status: 'completed' as const, duration: 50 });

      expect(smallStore.size).toBe(3);
      expect(await smallStore.getQuery('q1')).not.toBeNull();
      expect((await smallStore.getQuery('q1'))?.status).toBe('completed');
    });
  });

  describe('getQueries', () => {
    beforeEach(async () => {
      const logs = [
        { queryId: 'q1', query: 'SELECT * FROM users', startTime: Date.now() - 3000, status: 'completed' as const },
        { queryId: 'q2', query: 'SELECT * FROM orders', startTime: Date.now() - 2000, status: 'completed' as const },
        { queryId: 'q3', query: 'SELECT * FROM products', startTime: Date.now() - 1000, status: 'error' as const },
        { queryId: 'q4', query: 'INSERT INTO users', startTime: Date.now(), status: 'started' as const }
      ];
      await store.batchInsert(logs);
    });

    it('returns correct pagination', async () => {
      const result = await store.getQueries({ limit: 2, offset: 0 });
      expect(result.queries.length).toBe(2);
      expect(result.total).toBe(4);

      const page2 = await store.getQueries({ limit: 2, offset: 2 });
      expect(page2.queries.length).toBe(2);
      expect(page2.total).toBe(4);
    });

    it('returns results ordered by insertion (most recent first)', async () => {
      const result = await store.getQueries({});
      expect(result.queries[0].queryId).toBe('q4'); // Most recent first
      expect(result.queries[3].queryId).toBe('q1'); // Oldest last
    });

    it('filters by status', async () => {
      const completed = await store.getQueries({ status: 'completed' });
      expect(completed.total).toBe(2);
      expect(completed.queries.every(q => q.status === 'completed')).toBe(true);

      const error = await store.getQueries({ status: 'error' });
      expect(error.total).toBe(1);
      expect(error.queries[0].queryId).toBe('q3');

      const started = await store.getQueries({ status: 'started' });
      expect(started.total).toBe(1);
      expect(started.queries[0].queryId).toBe('q4');
    });

    it('searches query text (case insensitive)', async () => {
      const result = await store.getQueries({ search: 'users' });
      expect(result.total).toBe(2);
      expect(result.queries.some(q => q.query.includes('users'))).toBe(true);

      const caseInsensitive = await store.getQueries({ search: 'ORDERS' });
      expect(caseInsensitive.total).toBe(1);
    });

    it('combines filters', async () => {
      const result = await store.getQueries({ status: 'completed', search: 'orders' });
      expect(result.total).toBe(1);
      expect(result.queries[0].queryId).toBe('q2');
    });

    it('uses default limit of 50', async () => {
      // Insert more records
      const logs = Array.from({ length: 60 }, (_, i) => ({
        queryId: `bulk-${i}`,
        query: `SELECT ${i}`,
        startTime: Date.now() + i,
        status: 'completed' as const
      }));
      await store.batchInsert(logs);

      const result = await store.getQueries({});
      expect(result.queries.length).toBe(50);
      expect(result.total).toBe(64); // 4 from beforeEach + 60 new
    });
  });

  describe('getQuery', () => {
    it('returns single query by ID', async () => {
      await store.addQuery({
        queryId: 'single-1',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed' as const
      });

      const result = await store.getQuery('single-1');
      expect(result).not.toBeNull();
      expect(result?.queryId).toBe('single-1');
    });

    it('returns null for non-existent query', async () => {
      const result = await store.getQuery('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getCacheStats', () => {
    it('calculates hitRate correctly', async () => {
      const logs = [
        { queryId: 'c1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' as const, cacheStatus: 'hit' as const },
        { queryId: 'c2', query: 'SELECT 2', startTime: Date.now(), status: 'completed' as const, cacheStatus: 'hit' as const },
        { queryId: 'c3', query: 'SELECT 3', startTime: Date.now(), status: 'completed' as const, cacheStatus: 'miss' as const },
        { queryId: 'c4', query: 'SELECT 4', startTime: Date.now(), status: 'completed' as const, cacheStatus: 'stale-hit' as const }
      ];
      await store.batchInsert(logs);

      const stats = await store.getCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.staleHits).toBe(1);
      expect(stats.revalidations).toBe(0);
      expect(stats.hitRate).toBe(0.75);
    });

    it('returns 0 hitRate when no cache queries', async () => {
      const stats = await store.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.staleHits).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('includes revalidations', async () => {
      const logs = [
        { queryId: 'r1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' as const, cacheStatus: 'revalidate' as const }
      ];
      await store.batchInsert(logs);

      const stats = await store.getCacheStats();
      expect(stats.revalidations).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes old queries based on maxDays', async () => {
      const now = Date.now();
      const logs = [
        { queryId: 'old-1', query: 'SELECT 1', startTime: now - (10 * 24 * 60 * 60 * 1000), status: 'completed' as const },
        { queryId: 'new-1', query: 'SELECT 2', startTime: now, status: 'completed' as const }
      ];
      await store.batchInsert(logs);

      await store.cleanup({ maxQueries: 1000, maxDays: 7 });

      const result = await store.getQueries({});
      expect(result.total).toBe(1);
      expect(result.queries[0].queryId).toBe('new-1');
    });

    it('respects maxQueries limit', async () => {
      const logs = Array.from({ length: 10 }, (_, i) => ({
        queryId: `limit-${i}`,
        query: `SELECT ${i}`,
        startTime: Date.now() + i,
        status: 'completed' as const
      }));
      await store.batchInsert(logs);

      await store.cleanup({ maxQueries: 5, maxDays: 365 });

      expect(store.size).toBe(5);
    });
  });

  describe('export/import', () => {
    it('round-trip preserves data', async () => {
      const logs = [
        {
          queryId: 'export-1',
          query: 'SELECT * FROM users',
          parameters: [1, 'test'],
          startTime: Date.now(),
          endTime: Date.now() + 100,
          duration: 100,
          status: 'completed' as const,
          rowCount: 10,
          cacheStatus: 'hit' as const,
          cacheKey: 'key-1'
        }
      ];
      await store.batchInsert(logs);

      // Export data
      const exported = await store.export('json');
      expect(typeof exported).toBe('string');

      // Create a new store and import
      const newStore = new MemoryStore();
      await newStore.initialize();
      await newStore.import(exported, 'json');

      // Verify imported data
      const result = await newStore.getQueries({});
      expect(result.total).toBe(1);

      const q1 = await newStore.getQuery('export-1');
      expect(q1?.parameters).toEqual([1, 'test']);
      expect(q1?.duration).toBe(100);
      expect(q1?.cacheStatus).toBe('hit');
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      const logs = [
        { queryId: 'clear-1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' as const },
        { queryId: 'clear-2', query: 'SELECT 2', startTime: Date.now(), status: 'completed' as const }
      ];
      await store.batchInsert(logs);

      await store.clear();

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
      expect(store.size).toBe(0);
    });
  });

  describe('close', () => {
    it('closes without error', async () => {
      await expect(store.close()).resolves.not.toThrow();
    });
  });

  describe('size property', () => {
    it('returns current number of entries', async () => {
      expect(store.size).toBe(0);

      await store.addQuery({ queryId: 'q1', query: 'SELECT 1', startTime: Date.now(), status: 'completed' as const });
      expect(store.size).toBe(1);

      await store.addQuery({ queryId: 'q2', query: 'SELECT 2', startTime: Date.now(), status: 'completed' as const });
      expect(store.size).toBe(2);
    });
  });
});
