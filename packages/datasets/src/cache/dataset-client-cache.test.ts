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
import { createMemoryCacheStore } from './semantic-query-cache.js';
import { createInMemoryBackend } from '../in-memory-backend.js';

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

  it('bypasses the cache and warns once when the call overrides the query builder without a scope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { factory, executions } = createCountingFactory();
      const { factory: override, executions: overrideExecutions } =
        createCountingFactory([{ revenue: 999 }]);
      const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

      const query = { measures: ['revenue'] };
      await analytics.execute(Orders, query);
      // Same signature, different data source: must not serve the cached rows.
      const overridden = await analytics.execute(Orders, query, {
        runtime: { builderFactory: override },
      });

      expect(executions).toHaveBeenCalledTimes(1);
      expect(overrideExecutions).toHaveBeenCalledTimes(1);
      expect(overridden.data).toEqual([{ revenue: 999 }]);
      expect(overridden.meta?.cache).toBeUndefined();

      // The silent bypass is diagnosed once, not per call.
      await analytics.execute(Orders, query, { runtime: { builderFactory: override } });
      expect(overrideExecutions).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('cache.scope');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn about unscoped overrides when caching was never requested', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { factory } = createCountingFactory();
      const { factory: override } = createCountingFactory([{ revenue: 999 }]);
      // No client TTL and no per-call TTL: nothing to cache, nothing to warn about.
      const analytics = createDatasetClient({ queryBuilder: factory });

      await analytics.execute(Orders, { measures: ['revenue'] }, {
        runtime: { builderFactory: override },
      });

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('caches builder-override calls when partitioned with cache.scope', async () => {
    const { factory } = createCountingFactory();
    const { factory: replicaA, executions: replicaAExecutions } =
      createCountingFactory([{ revenue: 1 }]);
    const { factory: replicaB, executions: replicaBExecutions } =
      createCountingFactory([{ revenue: 2 }]);
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    const query = { measures: ['revenue'] };
    const onReplica = (builderFactory: QueryBuilderFactoryLike, scope: string) =>
      analytics.execute(Orders, query, { runtime: { builderFactory }, cache: { scope } });

    await onReplica(replicaA, 'replica-a');
    const hitA = await onReplica(replicaA, 'replica-a');
    expect(replicaAExecutions).toHaveBeenCalledTimes(1);
    expect(hitA.meta?.cache).toMatchObject({ hit: true });
    expect(hitA.data).toEqual([{ revenue: 1 }]);

    // A different scope never sees replica A's entries.
    const missB = await onReplica(replicaB, 'replica-b');
    expect(replicaBExecutions).toHaveBeenCalledTimes(1);
    expect(missB.data).toEqual([{ revenue: 2 }]);
  });

  it('client-level cache.scope separates clients sharing one store', async () => {
    const store = createMemoryCacheStore();
    const { factory: factoryA, executions: executionsA } =
      createCountingFactory([{ revenue: 1 }]);
    const { factory: factoryB, executions: executionsB } =
      createCountingFactory([{ revenue: 2 }]);
    const clientA = createDatasetClient({
      queryBuilder: factoryA,
      cache: { ttlMs: 60_000, store, scope: 'warehouse-a' },
    });
    const clientB = createDatasetClient({
      queryBuilder: factoryB,
      cache: { ttlMs: 60_000, store, scope: 'warehouse-b' },
    });

    const query = { measures: ['revenue'] };
    await clientA.execute(Orders, query);
    const fromB = await clientB.execute(Orders, query);

    expect(executionsA).toHaveBeenCalledTimes(1);
    expect(executionsB).toHaveBeenCalledTimes(1);
    expect(fromB.data).toEqual([{ revenue: 2 }]);
  });

  it('caches metric and dataset queries on backend-only clients', async () => {
    // Regression: the pre-cache validation must not dry-build SQL through the
    // throwing placeholder builder that backend clients are constructed with.
    const backend = createInMemoryBackend({
      orders: [
        { country: 'ES', amount: 10 },
        { country: 'DE', amount: 20 },
      ],
    });
    const analytics = createDatasetClient({ backend, cache: { ttlMs: 60_000 } });

    const metricFirst = await analytics.execute(revenue, { dimensions: ['country'] });
    const metricSecond = await analytics.execute(revenue, { dimensions: ['country'] });
    expect(metricFirst.data.length).toBeGreaterThan(0);
    expect(metricSecond.meta?.cache).toMatchObject({ hit: true });

    const datasetFirst = await analytics.execute(Orders, { measures: ['revenue'] });
    const datasetSecond = await analytics.execute(Orders, { measures: ['revenue'] });
    expect(datasetFirst.data.length).toBeGreaterThan(0);
    expect(datasetSecond.meta?.cache).toMatchObject({ hit: true });
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

  it('distinguishes Date and bigint filter values', () => {
    // Regression: Dates used to serialize as '{}', collapsing every date
    // filter onto one cache key.
    const sig = (value: unknown) =>
      buildDatasetQuerySignature(Orders, {
        measures: ['revenue'],
        filters: [{ field: 'status', operator: 'gte', value }],
      });
    expect(sig(new Date('2026-01-01'))).not.toBe(sig(new Date('2026-06-01')));
    expect(sig(new Date('2026-01-01'))).toBe(sig(new Date('2026-01-01')));
    expect(sig(new Date('2026-01-01'))).toBe(sig('2026-01-01T00:00:00.000Z'));
    expect(sig(1n)).not.toBe(sig(2n));
    expect(sig(1n)).not.toBe(sig(1));
    expect(sig(1n)).not.toBe(sig('1n'));
  });

  it('embeds the explicit cache scope', () => {
    const scoped = (scope?: string) =>
      buildDatasetQuerySignature(Orders, { measures: ['revenue'] }, scope ? { cache: { scope } } : {});
    expect(scoped('a')).not.toBe(scoped('b'));
    expect(scoped('a')).not.toBe(scoped());
    expect(scoped()).toBe(buildDatasetQuerySignature(Orders, { measures: ['revenue'] }));
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
