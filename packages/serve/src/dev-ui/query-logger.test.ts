import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DevQueryLogger, type QueryLogEvent } from './query-logger.js';
import { MemoryStore } from './storage/index.js';
import { ServeQueryLogger, type ServeQueryEvent } from '../query-logger.js';

describe('DevQueryLogger', () => {
  let store: MemoryStore;
  let queryLogger: DevQueryLogger;
  let serveLogger: ServeQueryLogger;

  beforeEach(async () => {
    store = new MemoryStore(1000);
    await store.initialize();
    serveLogger = new ServeQueryLogger();
    queryLogger = new DevQueryLogger(store, {
      batchSize: 5,
      flushInterval: 100
    });
  });

  afterEach(async () => {
    await queryLogger.shutdown();
    await store.close();
  });

  const emitServeEvent = (event: Partial<ServeQueryEvent>) => {
    serveLogger.emit({
      requestId: 'test-id',
      endpointKey: 'testEndpoint',
      path: '/test',
      method: 'GET',
      status: 'completed',
      startTime: Date.now(),
      ...event,
    });
  };

  describe('initialize', () => {
    it('subscribes to ServeQueryLogger events', () => {
      expect(serveLogger.listenerCount).toBe(0);

      queryLogger.initialize(serveLogger);

      expect(serveLogger.listenerCount).toBe(1);
    });

    it('only initializes once', () => {
      queryLogger.initialize(serveLogger);
      queryLogger.initialize(serveLogger); // Second call should be ignored

      expect(serveLogger.listenerCount).toBe(1);
    });
  });

  describe('handleServeEvent', () => {
    it('converts serve events to query logs', async () => {
      queryLogger.initialize(serveLogger);

      emitServeEvent({
        requestId: 'req-123',
        endpointKey: 'getUsers',
        path: '/api/users',
        method: 'GET',
        status: 'completed',
        startTime: 1000,
        endTime: 1100,
        durationMs: 100,
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('req-123');
      expect(result).not.toBeNull();
      expect(result?.query).toBe('GET /api/users');
      expect(result?.endpointKey).toBe('getUsers');
      expect(result?.duration).toBe(100);
    });

    it('includes cache info when available', async () => {
      queryLogger.initialize(serveLogger);

      emitServeEvent({
        requestId: 'req-cache',
        path: '/api/users',
        method: 'GET',
        status: 'completed',
        cache: {
          status: 'hit',
          age: 5000,
          key: 'hq:getUsers:{}',
        },
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('req-cache');
      expect(result?.cacheStatus).toBe('hit');
      expect(result?.cacheKey).toBe('hq:getUsers:{}');
      expect(result?.cacheAgeMs).toBe(5000);
    });
  });

  describe('batch processing', () => {
    it('flushes when batch size is reached', async () => {
      queryLogger.initialize(serveLogger);

      // Add exactly batchSize logs
      for (let i = 0; i < 5; i++) {
        emitServeEvent({
          requestId: `req-${i}`,
          path: `/test/${i}`,
        });
      }

      // Wait a moment for async flush
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.flushCount).toBeGreaterThanOrEqual(1);
      expect(stats.persisted).toBe(5);
    });

    it('flushes on interval even below batch size', async () => {
      queryLogger.initialize(serveLogger);

      emitServeEvent({ requestId: 'single-req' });

      const statsBefore = queryLogger.getStats();
      expect(statsBefore.queueSize).toBe(1);

      // Wait for flush interval
      await new Promise(resolve => setTimeout(resolve, 150));

      const statsAfter = queryLogger.getStats();
      expect(statsAfter.queueSize).toBe(0);
      expect(statsAfter.persisted).toBe(1);
    });
  });

  describe('event emission', () => {
    it('emits query:started event', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitServeEvent({ status: 'started' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:started');
    });

    it('emits query:completed event', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitServeEvent({ status: 'completed' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:completed');
    });

    it('emits query:error event', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitServeEvent({
        status: 'error',
        error: new Error('Connection failed'),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:error');
    });

    it('allows unsubscribing from events', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      const unsubscribe = queryLogger.onEvent(event => events.push(event));

      emitServeEvent({ requestId: 'req-1' });
      expect(events).toHaveLength(1);

      unsubscribe();

      emitServeEvent({ requestId: 'req-2' });
      expect(events).toHaveLength(1); // No new events
    });

    it('handles listener errors gracefully', async () => {
      queryLogger.initialize(serveLogger);

      queryLogger.onEvent(() => {
        throw new Error('Listener error');
      });

      // Should not throw
      expect(() => {
        emitServeEvent({});
      }).not.toThrow();
    });
  });

  describe('stats tracking', () => {
    it('tracks total logged', async () => {
      queryLogger.initialize(serveLogger);

      for (let i = 0; i < 3; i++) {
        emitServeEvent({ requestId: `req-${i}` });
      }

      const stats = queryLogger.getStats();
      expect(stats.totalLogged).toBe(3);
    });

    it('tracks persisted count', async () => {
      queryLogger.initialize(serveLogger);

      for (let i = 0; i < 5; i++) {
        emitServeEvent({ requestId: `req-${i}` });
      }

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.persisted).toBe(5);
    });

    it('tracks flush count and average batch size', async () => {
      queryLogger.initialize(serveLogger);

      // First batch of 5
      for (let i = 0; i < 5; i++) {
        emitServeEvent({ requestId: `req-${i}` });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Second batch of 5
      for (let i = 5; i < 10; i++) {
        emitServeEvent({ requestId: `req-${i}` });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.flushCount).toBe(2);
      expect(stats.avgBatchSize).toBe(5);
    });
  });

  describe('shutdown', () => {
    it('flushes remaining queue', async () => {
      queryLogger.initialize(serveLogger);

      // Add some logs (below batch size)
      for (let i = 0; i < 3; i++) {
        emitServeEvent({ requestId: `req-${i}` });
      }

      const statsBefore = queryLogger.getStats();
      expect(statsBefore.queueSize).toBe(3);

      await queryLogger.shutdown();

      const result = await store.getQueries({});
      expect(result.total).toBe(3);
    });

    it('unsubscribes from ServeQueryLogger', async () => {
      queryLogger.initialize(serveLogger);
      expect(serveLogger.listenerCount).toBe(1);

      await queryLogger.shutdown();

      expect(serveLogger.listenerCount).toBe(0);
    });

    it('stops accepting new logs after shutdown', async () => {
      queryLogger.initialize(serveLogger);

      await queryLogger.shutdown();

      // Manually call log since serve logger handler was removed
      queryLogger.log({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed',
      });

      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await store.getQueries({});
      expect(result.total).toBe(0);
    });

    it('clears event listeners', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      // Trigger one event before shutdown
      emitServeEvent({ requestId: 'req-0' });
      expect(events).toHaveLength(1);

      await queryLogger.shutdown();

      // Create new logger
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
      queryLogger.initialize(serveLogger);

      emitServeEvent({ requestId: 'req-1' });

      // Original listener should not receive new events
      expect(events).toHaveLength(1);
    });
  });

  describe('manual logging', () => {
    it('allows manual log entry', async () => {
      queryLogger.initialize(serveLogger);

      queryLogger.log({
        query: 'MANUAL SELECT',
        startTime: Date.now(),
        status: 'completed',
        queryId: 'manual-1',
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('manual-1');
      expect(result).not.toBeNull();
      expect(result?.query).toBe('MANUAL SELECT');
    });

    it('generates queryId for manual logs if not provided', async () => {
      queryLogger.initialize(serveLogger);

      queryLogger.log({
        query: 'MANUAL SELECT',
        startTime: Date.now(),
        status: 'completed',
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
      queryLogger.initialize(serveLogger);

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        emitServeEvent({
          requestId: `perf-req-${i}`,
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
