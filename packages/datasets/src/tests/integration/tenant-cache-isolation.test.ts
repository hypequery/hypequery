import { beforeAll, afterAll, expect, it } from 'vitest';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { createInMemoryBackend } from '../../in-memory-backend.js';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import type { SemanticCacheEntry, SemanticCacheStore } from '../../cache/semantic-query-cache.js';
import { TEST_CONNECTION_CONFIG, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'tenant_cache_isolation';
const Sales = dataset('tenantCacheIsolation', {
  source: table, tenantKey: 'tenant',
  dimensions: { tenant: dimension.string(), amount: dimension.number({ column: 'AMOUNT' }), id: dimension.number() },
  measures: { revenue: measure.sum('amount'), count: measure.count('id') },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const rows = [{ tenant: 'A', AMOUNT: 10, id: 1 }, { tenant: 'B', AMOUNT: 900, id: 2 }];
const factory = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database });

beforeAll(async () => {
  await runSql(`CREATE TABLE ${TEST_CONNECTION_CONFIG.database}.${table} (tenant String, AMOUNT Float64, id UInt32) ENGINE=Memory`);
  await insertRows(table, rows);
});
afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${TEST_CONNECTION_CONFIG.database}.${table}`); });

it.each([
  { target: Sales, path: 'backend' }, { target: Revenue, path: 'backend' },
  { target: Sales, path: 'builder' }, { target: Revenue, path: 'builder' },
])('preserves tenant isolation across deferred cache execution: $path $target.name', async ({ target, path }) => {
  const entries = new Map<string, SemanticCacheEntry>();
  let resolveRead!: () => void;
  let first = true;
  const gate = new Promise<void>(resolve => { resolveRead = resolve; });
  const store: SemanticCacheStore = {
    get: async key => { if (first) { first = false; await gate; } return entries.get(key); },
    set: (key, value) => { entries.set(key, value); },
    delete: key => { entries.delete(key); },
  };
  const cached = createDatasetClient({
    ...(path === 'backend' ? { backend: createInMemoryBackend({ [table]: rows }) } : { queryBuilder: factory }),
    cache: { ttlMs: 60000, store },
  });
  const context = { runtime: { tenant: 'A' } };
  const pending = cached.execute(target, {}, context);
  context.runtime.tenant = 'B';
  resolveRead();
  const result = await pending;
  expect(Number(result.data[0]?.revenue)).toBe(10);
  const hit = await cached.execute(target, {}, { runtime: { tenant: 'A' } });
  expect(hit.meta.cache?.hit).toBe(true);
  expect(Number(hit.data[0]?.revenue)).toBe(10);
  const other = await cached.execute(target, {}, { runtime: { tenant: 'B' } });
  expect(other.meta.cache?.hit).toBe(false);
  expect(Number(other.data[0]?.revenue)).toBe(900);
});
