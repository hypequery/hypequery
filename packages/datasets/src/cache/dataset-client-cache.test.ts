/**
 * End-to-end caching behavior through `createDatasetClient`: identical
 * queries hit the cache, different queries / tenants / targets do not, and
 * per-call context controls override client defaults.
 */
import { describe, expect, it, vi } from 'vitest';
import { dataset, dimension, measure } from '../index.js';
import { createDatasetClient } from '../executor.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import {
  buildDatasetQuerySignature,
  buildMetricQuerySignature,
  stableStringify,
} from './query-signature.js';

function createCountingFactory(rows: Array<Record<string, unknown>> = [{ revenue: 100 }]) {
  const executions = vi.fn();

  function createBuilder(): QueryBuilderLike {
    const builder: QueryBuilderLike = {
      select: () => builder,
      sum: () => builder,
      count: () => builder,
      countDistinct: () => builder,
      avg: () => builder,
      min: () => builder,
      max: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async <T,>() => {
        executions();
        return structuredClone(rows) as T[];
      },
    };
    return builder;
  }

  const factory: QueryBuilderFactoryLike = {
    table: () => createBuilder(),
    rawQuery: async <T,>() => {
      executions();
      return structuredClone(rows) as T[];
    },
  };

  return { factory, executions };
}

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    status: dimension.string(),
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const TenantOrders = dataset('tenant_orders', {
  source: 'tenant_orders',
  tenantKey: 'tenant_id',
  dimensions: {
    tenantId: dimension.string({ column: 'tenant_id' }),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });

describe('DatasetClient result caching', () => {
  it('caches identical dataset queries within the client TTL', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    const query = { dimensions: ['country'], measures: ['revenue'] };
    const first = await analytics.execute(Orders, query);
    const second = await analytics.execute(Orders, query);

    expect(executions).toHaveBeenCalledTimes(1);
    expect(first.meta?.cache).toEqual({ hit: false });
    expect(second.meta?.cache).toMatchObject({ hit: true });
    expect(second.data).toEqual(first.data);
  });

  it('caches identical metric queries and separates different queries', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    await analytics.execute(revenue, { dimensions: ['country'] });
    await analytics.execute(revenue, { dimensions: ['country'] });
    expect(executions).toHaveBeenCalledTimes(1);

    await analytics.execute(revenue, { dimensions: ['status'] });
    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('does not cache when the client has no cache config', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    await analytics.execute(Orders, { measures: ['revenue'] });
    await analytics.execute(Orders, { measures: ['revenue'] });

    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('per-call context TTL opts in without client defaults', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    const context = { cache: { ttlMs: 60_000 } };
    await analytics.execute(Orders, { measures: ['revenue'] }, context);
    const hit = await analytics.execute(Orders, { measures: ['revenue'] }, context);

    expect(executions).toHaveBeenCalledTimes(1);
    expect(hit.meta?.cache).toMatchObject({ hit: true });
  });

  it('context cache:false bypasses the client default cache', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    await analytics.execute(Orders, { measures: ['revenue'] });
    await analytics.execute(Orders, { measures: ['revenue'] }, { cache: false });

    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('partitions cache entries per tenant scope', async () => {
    const { factory, executions } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    const query = { measures: ['revenue'] };
    const tenantA = { runtime: { tenant: 'tenant_a' }, };
    const tenantB = { runtime: { tenant: 'tenant_b' }, };

    await analytics.execute(TenantOrders, query, tenantA);
    await analytics.execute(TenantOrders, query, tenantA);
    expect(executions).toHaveBeenCalledTimes(1);

    await analytics.execute(TenantOrders, query, tenantB);
    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('never caches invalid queries', () => {
    const { factory } = createCountingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    // Validation throws synchronously, before the cache is consulted.
    expect(() => analytics.execute(Orders, { dimensions: ['nope'] }))
      .toThrow(/Unknown dimensions/);
  });
});

describe('query signatures', () => {
  it('is insensitive to object key order but sensitive to values', () => {
    expect(stableStringify({ a: 1, b: [{ y: 2, x: 1 }] }))
      .toBe(stableStringify({ b: [{ x: 1, y: 2 }], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('separates dataset and metric signatures for the same shape', () => {
    const datasetSig = buildDatasetQuerySignature(Orders, {});
    const metricSig = buildMetricQuerySignature(revenue, {});
    expect(datasetSig).not.toBe(metricSig);
  });

  it('distinguishes filters, pagination, and grain', () => {
    const base = buildDatasetQuerySignature(Orders, { measures: ['revenue'] });
    expect(buildDatasetQuerySignature(Orders, {
      measures: ['revenue'],
      filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
    })).not.toBe(base);
    expect(buildDatasetQuerySignature(Orders, { measures: ['revenue'], limit: 10 })).not.toBe(base);
    expect(buildDatasetQuerySignature(Orders, { measures: ['revenue'], offset: 10 })).not.toBe(base);
  });

  it('embeds the tenant scope for tenant-keyed datasets only', () => {
    const scoped = (tenant: string) =>
      buildDatasetQuerySignature(TenantOrders, { measures: ['revenue'] }, { runtime: { tenant } });
    expect(scoped('tenant_a')).not.toBe(scoped('tenant_b'));

    const unscoped = (tenant: string) =>
      buildDatasetQuerySignature(Orders, { measures: ['revenue'] }, { runtime: { tenant } });
    expect(unscoped('tenant_a')).toBe(unscoped('tenant_b'));
  });
});
