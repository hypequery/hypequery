import { describe, expect, it } from 'vitest';
import { createDatasetClient, createMemoryCacheStore, dataset, dimension, measure } from '@hypequery/datasets';
import { createPostgresQueryBuilder, type PostgresDriver } from './index.js';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { amount: dimension.number() },
  measures: { revenue: measure.sum('amount') },
});

function driver(revenue: string): PostgresDriver {
  return { query: async <T>() => [{ revenue }] as T[] };
}

describe('result cache keys', () => {
  it('never share an entry across engines, but do within one', async () => {
    const store = createMemoryCacheStore();
    // A shared secret lets clients on one store reuse each other's entries.
    const cache = { ttlMs: 60_000, store, secret: new Uint8Array(32).fill(7) };
    const postgres = createPostgresQueryBuilder({ driver: driver('1') });
    // A builder without the Postgres dialect plans as ClickHouse: another engine.
    const other = createPostgresQueryBuilder({ driver: driver('2') });
    const clickhouseLike = { table: other.table, rawQuery: other.rawQuery };
    const samePostgres = createPostgresQueryBuilder({ driver: driver('3') });
    const run = (queryBuilder: Parameters<typeof createDatasetClient>[0]['queryBuilder']) =>
      createDatasetClient({ queryBuilder, cache }).execute(Orders, { measures: ['revenue'] });

    expect((await run(postgres)).data).toEqual([{ revenue: '1' }]);
    // Another engine misses the Postgres entry and runs its own query.
    expect((await run(clickhouseLike)).data).toEqual([{ revenue: '2' }]);
    // The same engine shares it.
    expect((await run(samePostgres)).data).toEqual([{ revenue: '1' }]);
  });
});
