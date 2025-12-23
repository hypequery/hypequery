import { createQueryBuilder } from '../../../index.js';
import { MemoryCacheProvider } from '../../cache/providers/memory-lru.js';
import { logger } from '../../utils/logger.js';
import {
  initializeTestConnection,
  setupTestDatabase,
  TEST_CONNECTION_CONFIG
} from './setup.js';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

const testSuite = SKIP_INTEGRATION_TESTS ? describe.skip : describe;

testSuite('Cache integration', () => {
  let dbWithCache: ReturnType<typeof createQueryBuilder<any>>;
  let capturedLogs: any[] = [];

  beforeAll(async () => {
    await initializeTestConnection();
    await setupTestDatabase();

    dbWithCache = createQueryBuilder({
      host: TEST_CONNECTION_CONFIG.host,
      username: TEST_CONNECTION_CONFIG.user,
      password: TEST_CONNECTION_CONFIG.password,
      database: TEST_CONNECTION_CONFIG.database,
      cache: {
        mode: 'cache-first',
        ttlMs: 5_000,
        staleTtlMs: 5_000,
        provider: new MemoryCacheProvider({ maxEntries: 100 })
      }
    });

    logger.configure({
      enabled: true,
      level: 'debug',
      onQueryLog: (log) => {
        capturedLogs.push(log);
      }
    });
  }, SETUP_TIMEOUT);

  beforeEach(() => {
    capturedLogs = [];
  });

  afterAll(() => {
    logger.configure({ enabled: false });
  });

  it('serves cached rows on repeated queries and emits cacheStatus metadata', async () => {
    const rowsFirst = await dbWithCache
      .table('users')
      .select(['id', 'user_name'])
      .where('status', 'eq', 'active')
      .execute({ queryId: 'cache-int-1' });

    const rowsSecond = await dbWithCache
      .table('users')
      .select(['id', 'user_name'])
      .where('status', 'eq', 'active')
      .execute({ queryId: 'cache-int-1' });

    expect(rowsFirst).toEqual(rowsSecond);

    const cacheHits = capturedLogs.filter(log => log?.cacheStatus === 'hit');
    expect(cacheHits.length).toBeGreaterThanOrEqual(1);
    expect(cacheHits[0].cacheKey).toBeDefined();
  });

  it('supports tag invalidation through the cache controller', async () => {
    // Populate cache
    await dbWithCache
      .table('users')
      .select(['id'])
      .cache({ tags: ['users'], ttlMs: 5_000 })
      .execute();

    capturedLogs = [];

    await dbWithCache.cache.invalidateTags(['users']);

    await dbWithCache
      .table('users')
      .select(['id'])
      .cache({ tags: ['users'], ttlMs: 5_000 })
      .execute();

    const cacheMisses = capturedLogs.filter(log => log?.cacheStatus === 'miss');
    expect(cacheMisses.length).toBeGreaterThanOrEqual(1);
  });
});
