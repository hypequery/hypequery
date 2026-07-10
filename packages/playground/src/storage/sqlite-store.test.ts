import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from './sqlite-store.js';
import type { QueryHistoryEntry } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(async () => {
    // Create a temporary database file for each test
    const tempDir = os.tmpdir();
    dbPath = path.join(tempDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new SQLiteStore(dbPath);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    // Clean up the database file
    try {
      fs.unlinkSync(dbPath);
      // Also remove WAL files if they exist
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore errors if files don't exist
    }
  });

  describe('initialize', () => {
    it('creates database file', async () => {
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('creates tables and indexes', async () => {
      // If we can insert and query, the schema was created correctly
      const log = {
        queryId: 'test-1',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed' as const
      };
      await store.addQuery(log);

      const result = await store.getQueries({});
      expect(result.total).toBe(1);
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
      expect(result).not.toBeNull();
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
    it('inserts multiple rows in single transaction', async () => {
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

    it('uses INSERT OR REPLACE for duplicate queryIds', async () => {
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

      await store.batchInsert([log1]);
      await store.batchInsert([log2]);

      const result = await store.getQueries({});
      expect(result.total).toBe(1);
      expect(result.queries[0].status).toBe('completed');
      expect(result.queries[0].duration).toBe(100);
    });
  });

  describe('getQueries', () => {
    beforeEach(async () => {
      // Insert test data
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

    it('returns results ordered by startTime descending', async () => {
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

    it('searches query text', async () => {
      const result = await store.getQueries({ search: 'users' });
      expect(result.total).toBe(2);
      expect(result.queries.some(q => q.query.includes('users'))).toBe(true);
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
      // hitRate = (hits + staleHits) / (hits + misses + staleHits) = 3/4 = 0.75
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

      const result = await store.getQueries({});
      expect(result.total).toBe(5);
      // Should keep the most recent 5
      expect(result.queries[0].queryId).toBe('limit-9');
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
        },
        {
          queryId: 'export-2',
          query: 'SELECT * FROM orders',
          startTime: Date.now(),
          status: 'error' as const,
          error: new Error('Connection failed')
        }
      ];
      await store.batchInsert(logs);

      // Export data
      const exported = await store.export('json');
      expect(typeof exported).toBe('string');

      // Create a new store and import
      const newDbPath = dbPath + '-import.db';
      const newStore = new SQLiteStore(newDbPath);
      await newStore.initialize();

      await newStore.import(exported, 'json');

      // Verify imported data
      const result = await newStore.getQueries({});
      expect(result.total).toBe(2);

      const q1 = await newStore.getQuery('export-1');
      expect(q1?.parameters).toEqual([1, 'test']);
      expect(q1?.duration).toBe(100);
      expect(q1?.cacheStatus).toBe('hit');

      await newStore.close();
      fs.unlinkSync(newDbPath);
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
    });
  });

  describe('close', () => {
    it('closes connection without error', async () => {
      await expect(store.close()).resolves.not.toThrow();
    });

    it('throws error when using closed store', async () => {
      await store.close();

      await expect(store.addQuery({
        queryId: 'test',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed' as const
      })).rejects.toThrow('Database not initialized');
    });
  });

  describe('in-memory database', () => {
    it('supports :memory: path', async () => {
      const memStore = new SQLiteStore(':memory:');
      await memStore.initialize();

      await memStore.addQuery({
        queryId: 'mem-1',
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed' as const
      });

      const result = await memStore.getQueries({});
      expect(result.total).toBe(1);

      await memStore.close();
    });
  });

  describe('mapRow', () => {
    it('preserves all fields correctly', async () => {
      const now = Date.now();
      const log = {
        queryId: 'map-1',
        query: 'SELECT * FROM users WHERE id = ?',
        parameters: [42],
        startTime: now,
        endTime: now + 150,
        duration: 150,
        status: 'completed' as const,
        rowCount: 1,
        cacheStatus: 'miss' as const,
        cacheKey: 'users:42',
        cacheMode: 'stale-while-revalidate',
        cacheAgeMs: 500,
        endpointKey: 'getUser',
        endpointPath: '/api/users/:id'
      };

      await store.addQuery(log);

      const result = await store.getQuery('map-1');
      expect(result).not.toBeNull();
      expect(result?.queryId).toBe('map-1');
      expect(result?.query).toBe('SELECT * FROM users WHERE id = ?');
      expect(result?.parameters).toEqual([42]);
      expect(result?.startTime).toBe(now);
      expect(result?.endTime).toBe(now + 150);
      expect(result?.duration).toBe(150);
      expect(result?.status).toBe('completed');
      expect(result?.rowCount).toBe(1);
      expect(result?.cacheStatus).toBe('miss');
      expect(result?.cacheKey).toBe('users:42');
      expect(result?.cacheMode).toBe('stale-while-revalidate');
      expect(result?.cacheAgeMs).toBe(500);
      expect(result?.endpointKey).toBe('getUser');
      expect(result?.endpointPath).toBe('/api/users/:id');
      expect(result?.id).toBeGreaterThan(0);
      expect(result?.createdAt).toBeGreaterThan(0);
    });
  });
});
