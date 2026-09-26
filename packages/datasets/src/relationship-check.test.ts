import { describe, it, expect } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { checkRelationships } from './relationship-check.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.number(), country: dimension.string() },
});

const Profiles = dataset('profiles', {
  source: 'profiles',
  tenantKey: 'tenant_id',
  dimensions: { orderId: dimension.number({ column: 'order_id' }) },
});

const Items = dataset('items', {
  source: 'items',
  dimensions: { orderId: dimension.number({ column: 'order_id' }) },
});

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { id: dimension.number() },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
    profile: hasOne(() => Profiles, { from: 'id', to: 'order_id' }),
    items: hasMany(() => Items, { from: 'id', to: 'order_id' }),
  },
});

interface RecordedQuery {
  table: string;
  select: string[];
  where: Array<[string, string, unknown]>;
}

/** Answers each count query from `counts[table]` and records what it was asked. */
function countingFactory(counts: Record<string, { rows: unknown; keys: unknown }>) {
  const queries: RecordedQuery[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table) {
      const recorded: RecordedQuery = { table, select: [], where: [] };
      queries.push(recorded);
      const builder = {
        count(column: string, alias?: string) {
          recorded.select.push(`count(${column}) AS ${alias}`);
          return builder;
        },
        countDistinct(column: string, alias?: string) {
          recorded.select.push(`countDistinct(${column}) AS ${alias}`);
          return builder;
        },
        where(column: string, operator: string, value: unknown) {
          recorded.where.push([column, operator, value]);
          return builder;
        },
        async execute() {
          const { rows, keys } = counts[table] ?? { rows: 0, keys: 0 };
          return [{ __hq_rows: rows, __hq_keys: keys }];
        },
      } as unknown as QueryBuilderLike;
      return builder;
    },
    rawQuery: async () => [],
  };
  return { factory, queries };
}

const tenant = { runtime: { tenant: { id: 't1' } } };

describe('checkRelationships', () => {
  it('passes when every to-one target key is unique and skips hasMany', async () => {
    const { factory, queries } = countingFactory({
      customers: { rows: '3', keys: '3' },
      profiles: { rows: 2, keys: 2 },
    });
    const result = await checkRelationships(Orders, { queryBuilder: factory, context: tenant });
    expect(result).toEqual({ ok: true, checked: ['customer', 'profile'], issues: [] });
    expect(queries.map((query) => query.table)).toEqual(['customers', 'profiles']);
    expect(queries[0]!.select).toEqual(['count(id) AS __hq_rows', 'countDistinct(id) AS __hq_keys']);
  });

  it('reports a to-one target whose key repeats', async () => {
    const { factory } = countingFactory({
      customers: { rows: '5', keys: '4' },
      profiles: { rows: 2, keys: 2 },
    });
    const result = await checkRelationships(Orders, { queryBuilder: factory, context: tenant });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        relationship: 'customer',
        kind: 'belongsTo',
        target: 'customers',
        source: 'customers',
        column: 'id',
        rows: 5,
        distinctKeys: 4,
      }),
    ]);
    expect(result.issues[0]!.message).toMatch(/declared belongsTo, but "customers.id" has 5 rows for 4 distinct keys/);
  });

  it('compares large driver counts exactly and preserves them in findings', async () => {
    const { factory } = countingFactory({
      customers: { rows: '9007199254740993', keys: '9007199254740992' },
    });
    const result = await checkRelationships(Orders, { queryBuilder: factory, relationships: ['customer'] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      rows: '9007199254740993',
      distinctKeys: '9007199254740992',
    });
    expect(result.issues[0]!.message).toContain('9007199254740993 rows for 9007199254740992 distinct keys');
  });

  it('rejects unsafe numeric counts that have already lost precision', async () => {
    const { factory } = countingFactory({
      customers: { rows: Number('9007199254740993'), keys: Number('9007199254740992') },
    });
    await expect(checkRelationships(Orders, { queryBuilder: factory, relationships: ['customer'] }))
      .rejects.toThrow(/Expected a non-negative integer row count/);
  });

  it('checks a tenant-scoped target within the runtime tenant', async () => {
    const { factory, queries } = countingFactory({ profiles: { rows: 1, keys: 1 } });
    await checkRelationships(Orders, {
      queryBuilder: factory,
      context: { runtime: { tenant: { in: ['t1', 't2'] } } },
      relationships: ['profile'],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.where).toEqual([['tenant_id', 'in', ['t1', 't2']]]);
  });

  it('requires tenant runtime for a tenant-scoped target', async () => {
    const { factory } = countingFactory({});
    await expect(checkRelationships(Orders, { queryBuilder: factory, relationships: ['profile'] }))
      .rejects.toThrow(/Cannot check relationship "profile": Dataset "profiles" requires runtime tenant scoping/);
  });

  it('rejects unknown and hasMany relationship names', async () => {
    const { factory } = countingFactory({});
    await expect(checkRelationships(Orders, { queryBuilder: factory, relationships: ['nope'] }))
      .rejects.toThrow(/Unknown relationship "nope"/);
    await expect(checkRelationships(Orders, { queryBuilder: factory, relationships: ['items'] }))
      .rejects.toThrow(/is hasMany/);
  });
});
