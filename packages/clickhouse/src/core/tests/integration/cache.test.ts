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
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const swallowBoomRejections = (reason: unknown) => {
  if (reason instanceof Error && reason.message.includes('boom')) {
    return;
  }
  throw reason;
};

testSuite('Cache integration', () => {
  let dbWithCache: ReturnType<typeof createQueryBuilder<any>>;
  let capturedLogs: any[] = [];

  beforeAll(async () => {
    process.on('unhandledRejection', swallowBoomRejections);
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
    process.off('unhandledRejection', swallowBoomRejections);
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
    const scopedDb = createQueryBuilder({
      host: TEST_CONNECTION_CONFIG.host,
      username: TEST_CONNECTION_CONFIG.user,
      password: TEST_CONNECTION_CONFIG.password,
      database: TEST_CONNECTION_CONFIG.database,
      cache: {
        mode: 'cache-first',
        ttlMs: 5_000,
        provider: new MemoryCacheProvider({ maxEntries: 100 })
      }
    });

    await scopedDb
      .table('users')
      .select(['id'])
      .cache({ tags: ['users'], ttlMs: 5_000 })
      .execute();

    await expect(scopedDb.cache.invalidateTags(['users'])).resolves.toBeUndefined();

    const rows = await scopedDb
      .table('users')
      .select(['id'])
      .cache({ tags: ['users'], ttlMs: 5_000 })
      .execute();

    expect(rows.length).toBeGreaterThan(0);
  });

  it('allows bypassing the cache per-execution', async () => {
    capturedLogs = [];

    await dbWithCache
      .table('users')
      .select(['id'])
      .execute({ cache: false, queryId: 'cache-bypass' });

    const bypassLogs = capturedLogs.filter(log => log?.queryId === 'cache-bypass' && log?.cacheStatus === 'bypass');
    expect(bypassLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('warms queries via db.cache.warm so subsequent runs hit the cache', async () => {
    const idQuery = () => dbWithCache
      .table('users')
      .select(['id'])
      .cache({ key: 'warm-users-id', ttlMs: 5_000 });

    const emailQuery = () => dbWithCache
      .table('users')
      .select(['email'])
      .cache({ key: 'warm-users-email', ttlMs: 5_000 });

    await dbWithCache.cache.warm([
      () => idQuery().execute(),
      () => emailQuery().execute()
    ]);

    capturedLogs = [];

    await idQuery().execute({ queryId: 'warm-hit-1' });
    await emailQuery().execute({ queryId: 'warm-hit-2' });

    const hitLogs = capturedLogs.filter(log =>
      ['warm-hit-1', 'warm-hit-2'].includes(log?.queryId ?? '') && log?.cacheStatus === 'hit'
    );
    expect(hitLogs.length).toBeGreaterThanOrEqual(2);
  });

  it('returns stale data then revalidates in stale-while-revalidate mode', async () => {
    const staleDb = createQueryBuilder({
      host: TEST_CONNECTION_CONFIG.host,
      username: TEST_CONNECTION_CONFIG.user,
      password: TEST_CONNECTION_CONFIG.password,
      database: TEST_CONNECTION_CONFIG.database,
      cache: {
        mode: 'stale-while-revalidate',
        ttlMs: 50,
        staleTtlMs: 5_000,
        provider: new MemoryCacheProvider({ maxEntries: 100 })
      }
    });

    const staleQuery = staleDb
      .table('users')
      .select(['id'])
      .orderBy('id', 'ASC');

    await staleQuery.execute({ queryId: 'swr-prime' });
    await sleep(300);

    await staleQuery.execute({ queryId: 'swr-stale' });

    const staleStats = staleDb.cache.getStats();
    expect(staleStats.staleHits).toBeGreaterThanOrEqual(1);

    const start = Date.now();
    while (Date.now() - start < 4000) {
      const stats = staleDb.cache.getStats();
      if (stats.revalidations > 0) {
        break;
      }
      await sleep(100);
    }

    const finalStats = staleDb.cache.getStats();
    expect(finalStats.revalidations).toBeGreaterThanOrEqual(1);
  });

});
