import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DevQueryLogger, type QueryLogEvent } from './query-logger.js';
import { MemoryStore } from './storage/index.js';
import { ServeQueryLogger } from '../query-logger.js';

/**
 * Helper to emit a serve-layer query event through the ServeQueryLogger.
 */
function emitQuery(
  serveLogger: ServeQueryLogger,
  overrides: Partial<import('../query-logger.js').ServeQueryEvent> = {}
) {
  serveLogger.emit({
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    endpointKey: 'testQuery',
    path: '/test',
    method: 'GET',
    status: 'completed',
    startTime: Date.now(),
    ...overrides,
  });
}

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

  describe('initialize', () => {
    it('subscribes to the serve query logger', () => {
      expect(serveLogger.listenerCount).toBe(0);
      queryLogger.initialize(serveLogger);
      expect(serveLogger.listenerCount).toBe(1);
    });

    it('only initializes once', () => {
      queryLogger.initialize(serveLogger);
      queryLogger.initialize(serveLogger); // Second call should be ignored
      expect(serveLogger.listenerCount).toBe(1);
    });

    it('works without a serve logger (manual log only)', () => {
      queryLogger.initialize(); // No serve logger
      queryLogger.log({
        query: 'SELECT 1',
        startTime: Date.now(),
        status: 'completed',
      });
      expect(queryLogger.getStats().totalLogged).toBe(1);
    });
  });

  describe('enqueue via serve events', () => {
    it('adds logs synchronously without blocking', () => {
      queryLogger.initialize(serveLogger);

      const start = performance.now();
      emitQuery(serveLogger);
      const duration = performance.now() - start;

      // Should return almost immediately (< 5ms for just enqueue)
      expect(duration).toBeLessThan(5);

      const stats = queryLogger.getStats();
      expect(stats.totalLogged).toBe(1);
      expect(stats.queueSize).toBe(1);
    });

    it('maps serve events to query log entries', async () => {
      queryLogger.initialize(serveLogger);

      emitQuery(serveLogger, {
        requestId: 'test-123',
        endpointKey: 'listUsers',
        path: '/users',
        method: 'GET',
        status: 'completed',
        startTime: 1000,
        endTime: 1050,
        durationMs: 50,
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQueries({});
      expect(result.total).toBe(1);
      expect(result.queries[0].queryId).toBe('test-123');
      expect(result.queries[0].query).toBe('GET /users');
      expect(result.queries[0].endpointKey).toBe('listUsers');
      expect(result.queries[0].endpointPath).toBe('/users');
      expect(result.queries[0].duration).toBe(50);
    });

    it('preserves requestId as queryId', async () => {
      queryLogger.initialize(serveLogger);

      emitQuery(serveLogger, { requestId: 'custom-request-id' });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await store.getQuery('custom-request-id');
      expect(result).not.toBeNull();
    });
  });

  describe('batch processing', () => {
    it('flushes when batch size is reached', async () => {
      queryLogger.initialize(serveLogger);

      // Add exactly batchSize logs
      for (let i = 0; i < 5; i++) {
        emitQuery(serveLogger, { requestId: `batch-${i}` });
      }

      // Wait a moment for async flush
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queryLogger.getStats();
      expect(stats.flushCount).toBeGreaterThanOrEqual(1);
      expect(stats.persisted).toBe(5);
    });

    it('flushes on interval even below batch size', async () => {
      queryLogger.initialize(serveLogger);

      emitQuery(serveLogger);

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
    it('emits query:started event', () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitQuery(serveLogger, { status: 'started' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:started');
    });

    it('emits query:completed event', () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitQuery(serveLogger, { status: 'completed', durationMs: 100 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:completed');
    });

    it('emits query:error event', () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitQuery(serveLogger, {
        status: 'error',
        error: new Error('Connection failed'),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('query:error');
    });

    it('allows unsubscribing from events', () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      const unsubscribe = queryLogger.onEvent(event => events.push(event));

      emitQuery(serveLogger);
      expect(events).toHaveLength(1);

      unsubscribe();

      emitQuery(serveLogger);
      expect(events).toHaveLength(1); // No new events
    });

    it('handles listener errors gracefully', () => {
      queryLogger.initialize(serveLogger);

      queryLogger.onEvent(() => {
        throw new Error('Listener error');
      });

      // Should not throw
      expect(() => {
        emitQuery(serveLogger);
      }).not.toThrow();
    });
  });

  describe('stats tracking', () => {
    it('tracks total logged', () => {
      queryLogger.initialize(serveLogger);

      for (let i = 0; i < 3; i++) {
        emitQuery(serveLogger, { requestId: `stat-${i}` });
      }

      const stats = queryLogger.getStats();
      expect(stats.totalLogged).toBe(3);
    });

    it('tracks persisted count', async () => {
      queryLogger.initialize(serveLogger);

      for (let i = 0; i < 5; i++) {
        emitQuery(serveLogger, { requestId: `persist-${i}` });
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
        emitQuery(serveLogger, { requestId: `batch1-${i}` });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Second batch of 5
      for (let i = 0; i < 5; i++) {
        emitQuery(serveLogger, { requestId: `batch2-${i}` });
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
        emitQuery(serveLogger, { requestId: `shutdown-${i}` });
      }

      const statsBefore = queryLogger.getStats();
      expect(statsBefore.queueSize).toBe(3);

      await queryLogger.shutdown();

      const result = await store.getQueries({});
      expect(result.total).toBe(3);
    });

    it('stops accepting new logs after shutdown', async () => {
      queryLogger.initialize(serveLogger);

      await queryLogger.shutdown();

      // Manually call log since serve logger was unsubscribed
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

    it('unsubscribes from serve logger', async () => {
      queryLogger.initialize(serveLogger);
      expect(serveLogger.listenerCount).toBe(1);

      await queryLogger.shutdown();
      expect(serveLogger.listenerCount).toBe(0);

      // Re-create for afterEach cleanup
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
    });

    it('clears event listeners', async () => {
      queryLogger.initialize(serveLogger);

      const events: QueryLogEvent[] = [];
      queryLogger.onEvent(event => events.push(event));

      emitQuery(serveLogger);
      expect(events).toHaveLength(1);

      await queryLogger.shutdown();

      // Create new logger with fresh serve logger
      const newServeLogger = new ServeQueryLogger();
      queryLogger = new DevQueryLogger(store, { batchSize: 5, flushInterval: 100 });
      queryLogger.initialize(newServeLogger);

      emitQuery(newServeLogger);

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
      queryLogger.initialize(serveLogger);

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        emitQuery(serveLogger);
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
