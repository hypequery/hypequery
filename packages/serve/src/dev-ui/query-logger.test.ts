import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DevQueryLogger, type QueryLogEvent } from './query-logger.js';
import { MemoryStore } from './storage/index.js';
import { logger as clickhouseLogger } from '@hypequery/clickhouse';

describe('DevQueryLogger', () => {
  let store: MemoryStore;
  let queryLogger: DevQueryLogger;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
    queryLogger = new DevQueryLogger(store, {
      batchSize: 5,
      flushInterval: 100
    });
  });

  afterEach(async () => {
    await queryLogger.shutdown();
    await store.close();
  });

  describe('initialize', () => {
    it('configures clickhouse logger with onQueryLog handler', () => {
      const configureSpy = vi.spyOn(clickhouseLogger, 'configure');

      queryLogger.initialize();

      expect(configureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          onQueryLog: expect.any(Function)
        })
      );
      configureSpy.mockRestore();
    });

    it('only initializes once', () => {
      const configureSpy = vi.spyOn(clickhouseLogger, 'configure');

      queryLogger.initialize();
      queryLogger.initialize(); // Second call should be ignored

      expect(configureSpy).toHaveBeenCalledTimes(1);
      configureSpy.mockRestore();
    });
  });

  describe('enqueue', () => {
    it('adds logs synchronously without blocking', () => {
      queryLogger.initialize();

      const start = performance.now();
      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });
      const duration = performance.now() - start;

      // Should return almost immediately (< 1ms for just enqueue)
      expect(duration).toBeLessThan(5);

      const stats = queryLogger.getStats();
      expect(stats.totalLogged).toBe(1);
      expect(stats.queueSize).toBe(1);
    });

    it('generates queryId if not provided', async () => {
      queryLogger.initialize();

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQueries({});
      expect(result.queries[0].queryId).toMatch(/^q-\d+-[a-z0-9]+$/);
    });

    it('preserves provided queryId', async () => {
      queryLogger.initialize();

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed',
        queryId: 'custom-id'
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('custom-id');
      expect(result).not.toBeNull();
    });
  });

  describe('batch processing', () => {
    it('flushes when batch size is reached', async () => {
      queryLogger.initialize();

      // Add exactly batchSize logs
      for (let i = 0; i < 5; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      // Wait a moment for async flush
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.flushCount).toBeGreaterThanOrEqual(1);
      expect(stats.persisted).toBe(5);
    });

    it('flushes on interval even below batch size', async () => {
      queryLogger.initialize();

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      const statsBefore = queryLogger.getStats();
      expect(statsBefore.queueSize).toBe(1);

      // Wait for flush interval
      await new Promise(resolve => setTimeout(resolve, 150));

      const statsAfter = queryLogger.getStats();
      expect(statsAfter.queueSize).toBe(0);
      expect(statsAfter.persisted).toBe(1);
    });
  });

  describe('endpoint context', () => {
    it('associates queries with endpoint context', async () => {
      queryLogger.initialize();

      queryLogger.setEndpointContext('getUsers', '/api/users');

      clickhouseLogger.logQuery({
        query: 'SELECT * FROM users',
        startTime: Date.now(),
        status: 'completed',
        queryId: 'endpoint-test'
      });

      queryLogger.clearEndpointContext();

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('endpoint-test');
      expect(result?.endpointKey).toBe('getUsers');
      expect(result?.endpointPath).toBe('/api/users');
    });

    it('does not track endpoints when disabled', async () => {
      // First shutdown the default logger
      await queryLogger.shutdown();

      const noEndpointLogger = new DevQueryLogger(store, {
        trackEndpoints: false,
        batchSize: 1,
        flushInterval: 50
      });
      noEndpointLogger.initialize();

      noEndpointLogger.setEndpointContext('getUsers', '/api/users');

      clickhouseLogger.logQuery({
        query: 'SELECT * FROM users',
        startTime: Date.now(),
        status: 'completed',
        queryId: 'no-endpoint-test'
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await store.getQuery('no-endpoint-test');
      expect(result?.endpointKey).toBeUndefined();
      expect(result?.endpointPath).toBeUndefined();

      await noEndpointLogger.shutdown();

      // Re-initialize queryLogger for afterEach cleanup
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
    });
  });

  describe('event emission', () => {
    it('emits query:started event', async () => {
      queryLogger.initialize();

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'started'
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:started');
    });

    it('emits query:completed event', async () => {
      queryLogger.initialize();

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed',
        duration: 100
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:completed');
    });

    it('emits query:error event', async () => {
      queryLogger.initialize();

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'error',
        error: new Error('Connection failed')
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:error');
    });

    it('allows unsubscribing from events', async () => {
      queryLogger.initialize();

      const events: QueryLogEvent[] = [];
      const unsubscribe = queryLogger.onEvent(event => events.push(event));

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      expect(events).toHaveLength(1);

      unsubscribe();

      clickhouseLogger.logQuery({
        query: 'SELECT 2',
        startTime: Date.now(),
        status: 'completed'
      });

      expect(events).toHaveLength(1); // No new events
    });

    it('handles listener errors gracefully', async () => {
      queryLogger.initialize();

      queryLogger.onEvent(() => {
        throw new Error('Listener error');
      });

      // Should not throw
      expect(() => {
        clickhouseLogger.logQuery({
          query: 'SELECT 1',
          startTime: Date.now(),
          status: 'completed'
        });
      }).not.toThrow();
    });
  });

  describe('stats tracking', () => {
    it('tracks total logged', async () => {
      queryLogger.initialize();

      for (let i = 0; i < 3; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      const stats = queryLogger.getStats();
      expect(stats.totalLogged).toBe(3);
    });

    it('tracks persisted count', async () => {
      queryLogger.initialize();

      for (let i = 0; i < 5; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.persisted).toBe(5);
    });

    it('tracks flush count and average batch size', async () => {
      queryLogger.initialize();

      // First batch of 5
      for (let i = 0; i < 5; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Second batch of 5
      for (let i = 5; i < 10; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.flushCount).toBe(2);
      expect(stats.avgBatchSize).toBe(5);
    });
  });

  describe('shutdown', () => {
    it('flushes remaining queue', async () => {
      queryLogger.initialize();

      // Add some logs (below batch size)
      for (let i = 0; i < 3; i++) {
        clickhouseLogger.logQuery({
          query: `SELECT ${i}`,
          startTime: Date.now(),
          status: 'completed'
        });
      }

      const statsBefore = queryLogger.getStats();
      expect(statsBefore.queueSize).toBe(3);

      await queryLogger.shutdown();

      const result = await store.getQueries({});
      expect(result.total).toBe(3);
    });

    it('stops accepting new logs after shutdown', async () => {
      queryLogger.initialize();

      await queryLogger.shutdown();

      // Manually call log since clickhouse logger handler was removed
      queryLogger.log({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
    });

    it('clears event listeners', async () => {
      queryLogger.initialize();

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      // Trigger one event before shutdown
      clickhouseLogger.logQuery({
        query: 'SELECT 0',
        startTime: Date.now(),
        status: 'completed'
      });
      expect(events).toHaveLength(1);

      await queryLogger.shutdown();

      // Create new logger
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
      queryLogger.initialize();

      clickhouseLogger.logQuery({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed'
      });

      // Original listener should not receive new events
      expect(events).toHaveLength(1);
    });
  });

  describe('manual logging', () => {
    it('allows manual log entry', async () => {
      queryLogger.initialize();

      queryLogger.log({
        query: 'MANUAL SELECT',
        startTime: Date.now(),
        status: 'completed',
        queryId: 'manual-1'
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('manual-1');
      expect(result).not.toBeNull();
      expect(result?.query).toBe('MANUAL SELECT');
    });

    it('generates queryId for manual logs if not provided', async () => {
      queryLogger.initialize();

      queryLogger.log({
        query: 'MANUAL SELECT',
        startTime: Date.now(),
        status: 'completed'
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQueries({});
      expect(result.total).toBe(1);
      expect(result.queries[0].queryId).toMatch(/^q-\d+-[a-z0-9]+$/);
    });
  });

  describe('performance', () => {
    it('query logger overhead < 0.5ms average', async () => {
      queryLogger.initialize();

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        clickhouseLogger.logQuery({
          query: 'SELECT * FROM test',
          startTime: Date.now(),
          status: 'completed'
        });
      }

      const end = performance.now();
      const avgOverhead = (end - start) / iterations;

      // Allow some margin for test environment variability
      expect(avgOverhead).toBeLessThan(0.5);

      // Cleanup - wait for flushes
      await queryLogger.shutdown();

      // Re-create for afterEach cleanup
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
    });
  });
});
