/**
 * The dataset-declared result ceiling and cache policy, exercised through
 * `createDatasetClient` so the wiring is covered, not just the helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import { dataset, dimension, measure } from '../index.js';
import { createDatasetClient } from '../executor.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';

/** Records the limit each executed query carried. */
function createRecordingFactory(rows: Array<Record<string, unknown>> = [{ revenue: 100 }]) {
  const limits: Array<number | undefined> = [];
  const executions = vi.fn();

  function createBuilder(): QueryBuilderLike {
    let limit: number | undefined;
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
      limit: (value?: number) => {
        limit = value;
        return builder;
      },
      offset: () => builder,
      toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async <T,>() => {
        limits.push(limit);
        executions();
        return structuredClone(rows) as T[];
      },
    };
    return builder;
  }

  const factory: QueryBuilderFactoryLike = {
    table: () => createBuilder(),
    rawQuery: async <T,>() => {
      limits.push(undefined);
      executions();
      return structuredClone(rows) as T[];
    },
  };

  return { factory, limits, executions };
}

const Bounded = dataset('bounded_orders', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  limits: { maxResultSize: 50 },
});

const Unbounded = dataset('unbounded_orders', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

const boundedRevenue = Bounded.metric('revenue', { measure: 'revenue' });

describe('declared result ceiling', () => {
  it('bounds a query that set no limit of its own', async () => {
    const { factory, limits } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    const result = await analytics.execute(Bounded, { dimensions: ['status'] });

    // Over-fetches one row to derive `hasMore`, so the executed limit is max + 1.
    expect(limits).toEqual([51]);
    expect(result.meta?.resultLimit).toEqual({ maxResultSize: 50, applied: 50 });
  });

  it('leaves a query that names a limit under the ceiling untouched', async () => {
    const { factory, limits } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    const result = await analytics.execute(Bounded, { dimensions: ['status'], limit: 10 });

    expect(limits).toEqual([11]);
    expect(result.meta?.resultLimit).toBeUndefined();
  });

  it('still rejects a limit above the ceiling rather than capping it', () => {
    const { factory } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    expect(() => analytics.execute(Bounded, { dimensions: ['status'], limit: 500 })).toThrow(
      /Too many results requested/,
    );
  });

  it('leaves a dataset with no declared ceiling unbounded', async () => {
    const { factory, limits } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    const result = await analytics.execute(Unbounded, { dimensions: ['status'] });

    expect(limits).toEqual([undefined]);
    expect(result.meta?.resultLimit).toBeUndefined();
  });

  it('applies the dataset ceiling to metric queries too', async () => {
    const { factory, limits } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    const result = await analytics.execute(boundedRevenue, {});

    expect(limits).toEqual([51]);
    expect(result.meta?.resultLimit).toEqual({ maxResultSize: 50, applied: 50 });
  });

  it('shares one cache entry between an unbounded call and one at the ceiling', async () => {
    const { factory, executions } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    await analytics.execute(Bounded, { dimensions: ['status'] });
    await analytics.execute(Bounded, { dimensions: ['status'], limit: 50 });

    expect(executions).toHaveBeenCalledTimes(1);
  });
});

const CachedDaily = dataset('cached_daily', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  cache: { ttlMs: 60_000, maxTtlMs: 120_000 },
});

const CeilingOnly = dataset('ceiling_only', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  cache: { maxTtlMs: 5_000 },
});

describe('declared cache policy', () => {
  it('caches on the declared TTL with no client-level cache configured', async () => {
    const { factory, executions } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    await analytics.execute(CachedDaily, { dimensions: ['status'] });
    await analytics.execute(CachedDaily, { dimensions: ['status'] });

    expect(executions).toHaveBeenCalledTimes(1);
  });

  it('lets a caller shorten the window below the declared default', async () => {
    vi.useFakeTimers();
    try {
      const { factory, executions } = createRecordingFactory();
      const analytics = createDatasetClient({ queryBuilder: factory });

      await analytics.execute(CachedDaily, { dimensions: ['status'] }, { cache: { ttlMs: 1_000 } });
      vi.advanceTimersByTime(2_000);
      await analytics.execute(CachedDaily, { dimensions: ['status'] }, { cache: { ttlMs: 1_000 } });

      expect(executions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps a caller TTL that exceeds the declared ceiling', async () => {
    vi.useFakeTimers();
    try {
      const { factory, executions } = createRecordingFactory();
      const analytics = createDatasetClient({ queryBuilder: factory });

      // Asks for an hour; the dataset ceiling is five seconds.
      const call = { cache: { ttlMs: 3_600_000 } };
      await analytics.execute(CeilingOnly, { dimensions: ['status'] }, call);
      vi.advanceTimersByTime(10_000);
      await analytics.execute(CeilingOnly, { dimensions: ['status'] }, call);

      expect(executions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a caller who opted out opted out', async () => {
    const { factory, executions } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    await analytics.execute(CachedDaily, { dimensions: ['status'] }, { cache: false });
    await analytics.execute(CachedDaily, { dimensions: ['status'] }, { cache: false });

    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('leaves a dataset with no declared policy on the client default', async () => {
    const { factory, executions } = createRecordingFactory();
    const analytics = createDatasetClient({ queryBuilder: factory });

    await analytics.execute(Unbounded, { dimensions: ['status'] });
    await analytics.execute(Unbounded, { dimensions: ['status'] });

    expect(executions).toHaveBeenCalledTimes(2);
  });
});
