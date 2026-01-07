import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createQueryBuilder } from '../../../index.js';
import { initializeTestConnection, setupTestDatabase } from './setup.js';
import { logger } from '../../utils/logger.js';

// Import centralized test configuration
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

// Only run these tests if not skipped
(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Logging Support', () => {
  let db: ReturnType<typeof createQueryBuilder<any>>;
  let queryLogs: any[] = [];

  async function collectStream(stream: WebReadableStream<any[]>) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  beforeAll(async () => {
    if (!SKIP_INTEGRATION_TESTS) {
      try {
        // Setup only - don't start/stop container (handled by shell script)
        db = await initializeTestConnection();
        await setupTestDatabase();

        // Configure logger to capture logs
        logger.configure({
          level: 'debug',
          enabled: true,
          onQueryLog: (log) => {
            queryLogs.push(log);
          }
        });
      } catch (error) {
        console.error('Failed to set up integration tests:', error);
        throw error;
      }
    }
  }, SETUP_TIMEOUT);

  beforeEach(() => {
    queryLogs = [];
  });

  it('should log query execution start and completion', async () => {
    await db
      .table('test_table')
      .select(['id', 'name'])
      .where('is_active', 'eq', 1)
      .execute();

    expect(queryLogs.length).toBe(2);
    expect(queryLogs[0].status).toBe('started');
    expect(queryLogs[1].status).toBe('completed');
    expect(queryLogs[1].duration).toBeDefined();
    expect(queryLogs[1].rowCount).toBeDefined();
  });

  it('should log query errors', async () => {
    try {
      await db
        .table('nonexistent_table')
        .select(['id'])
        .execute();
    } catch (error) {
      // Expected error
    }

    expect(queryLogs.length).toBe(2);
    expect(queryLogs[0].status).toBe('started');
    expect(queryLogs[1].status).toBe('error');
    expect(queryLogs[1].error).toBeDefined();
  });

  it('should log streaming queries', async () => {
    const stream = await db
      .table('test_table')
      .select(['id', 'name'])
      .stream();

    const reader = stream.getReader();
    const results: any[] = [];

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all log events are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(queryLogs.length).toBe(2);
    expect(queryLogs[0].status).toBe('started');
    expect(queryLogs[1].status).toBe('completed');
    expect(queryLogs[1].duration).toBeDefined();
  });


  it('should include query parameters in logs', async () => {
    await db
      .table('test_table')
      .select(['id', 'name'])
      .where('price', 'gt', 20)
      .execute();

    expect(queryLogs[0].parameters).toBeDefined();
    expect(queryLogs[0].parameters).toContain(20);
  });

  it('should handle disabled logging', async () => {
    // Simply disable logging - our logger should prevent callbacks from executing
    logger.configure({ enabled: false });

    await db
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(0);

    // Re-enable logging with callback
    logger.configure({
      enabled: true,
      onQueryLog: (log) => {
        queryLogs.push(log);
      }
    });


    await db
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(2);  // Now we should get both start and complete logs
  });

  it('should log concurrent streaming queries without losing entries', async () => {
    const streams = await Promise.all([
      db.table('test_table').select(['id']).stream(),
      db.table('orders').select(['id']).stream()
    ]);

    await Promise.all(streams.map(stream => collectStream(stream)));

    const completedLogs = queryLogs.filter(log => log.status === 'completed');
    const startedLogs = queryLogs.filter(log => log.status === 'started');

    expect(startedLogs.length).toBe(2);
    expect(completedLogs.length).toBe(2);
  });
}); 
