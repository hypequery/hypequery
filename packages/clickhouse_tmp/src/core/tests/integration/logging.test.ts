import { createQueryBuilder } from '../../../index';
import { setupTestDatabase, TEST_DATA, TestSchema } from './setup';
import { logger } from '../../utils/logger';

describe('Logging Support', () => {
  let builder: ReturnType<typeof createQueryBuilder<TestSchema>>;
  let queryLogs: any[] = [];

  beforeAll(async () => {
    await setupTestDatabase();
    builder = createQueryBuilder<TestSchema>({
      host: process.env.CLICKHOUSE_TEST_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_TEST_USER || 'hypequery',
      password: process.env.CLICKHOUSE_TEST_PASSWORD || 'hypequery_test',
      database: process.env.CLICKHOUSE_TEST_DB || 'test_db'
    });

    // Configure logger to capture logs
    logger.configure({
      level: 'debug',
      enabled: true,
      onQueryLog: (log) => {
        queryLogs.push(log);
      }
    });
  });

  beforeEach(() => {
    queryLogs = [];
  });

  it('should log query execution start and completion', async () => {
    await builder
      .table('test_table')
      .select(['id', 'name'])
      .where('active', 'eq', 1)
      .execute();

    expect(queryLogs.length).toBe(2);
    expect(queryLogs[0].status).toBe('started');
    expect(queryLogs[1].status).toBe('completed');
    expect(queryLogs[1].duration).toBeDefined();
    expect(queryLogs[1].rowCount).toBeDefined();
  });

  it('should log query errors', async () => {
    try {
      await (builder as any)
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
    const stream = await builder
      .table('test_table')
      .select(['id', 'name'])
      .stream();

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value: rows } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    expect(queryLogs.length).toBe(2);
    expect(queryLogs[0].status).toBe('started');
    expect(queryLogs[1].status).toBe('completed');
    expect(queryLogs[1].duration).toBeDefined();
    expect(queryLogs[1].rowCount).toBeDefined();
  });

  it('should respect log level configuration', async () => {
    logger.configure({ level: 'error' });

    await builder
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(0);

    logger.configure({ level: 'debug' });

    await builder
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(2);
  });

  it('should include query parameters in logs', async () => {
    await builder
      .table('test_table')
      .select(['id', 'name'])
      .where('price', 'gt', 20)
      .execute();

    expect(queryLogs[0].parameters).toBeDefined();
    expect(queryLogs[0].parameters).toContain(20);
  });

  it('should handle disabled logging', async () => {
    logger.configure({ enabled: false });

    await builder
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(0);

    logger.configure({ enabled: true });

    await builder
      .table('test_table')
      .select(['id', 'name'])
      .execute();

    expect(queryLogs.length).toBe(2);
  });
}); 