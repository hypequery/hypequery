import { describe, it, expect } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { percentile, median, argMax as argMaxAgg, stddev as stddevAgg } from './aggregations.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend, type InMemoryTables } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { serializeSemanticContract } from './contract.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    p95Amount: measure.percentile('amount', 0.95),
    medianAmount: measure.median('amount'),
    latestAmount: measure.argMax('amount', 'createdAt'),
    firstAmount: measure.argMin('amount', 'createdAt'),
    latestStatus: measure.argMax('status', 'createdAt'),
    amountStddev: measure.stddev('amount'),
    amountVariance: measure.variance('amount'),
    completedP95: measure.percentile('amount', 0.95, {
      filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
    }),
  },
});

const rows = [
  { id: 1, status: 'completed', amount: 10, created_at: '2024-01-01' },
  { id: 2, status: 'completed', amount: 20, created_at: '2024-01-02' },
  { id: 3, status: 'pending', amount: 30, created_at: '2024-01-03' },
  { id: 4, status: 'completed', amount: 40, created_at: '2024-01-04' },
  { id: 5, status: 'cancelled', amount: 50, created_at: '2024-01-05' },
];

const tables: InMemoryTables = { orders: rows };

function createSqlCapturingFactory(): { factory: QueryBuilderFactoryLike; queries: string[] } {
  const queries: string[] = [];
  function createBuilder(table: string): QueryBuilderLike {
    const state = { select: [] as string[], where: [] as string[], groupBy: [] as string[] };
    const push = (part: string) => { state.select.push(part); return builder; };
    const buildSql = () => [
      `SELECT ${state.select.join(', ')} FROM ${table}`,
      state.where.length ? `WHERE ${state.where.join(' AND ')}` : '',
      state.groupBy.length ? `GROUP BY ${state.groupBy.join(', ')}` : '',
    ].filter(Boolean).join(' ');

    const builder: QueryBuilderLike = {
      select: (args) => { state.select.push(...(Array.isArray(args) ? args : [args])); return builder; },
      sum: (c, a) => push(`SUM(${c}) AS ${a}`),
      count: (c, a) => push(`COUNT(${c}) AS ${a}`),
      countDistinct: (c, a) => push(`COUNT(DISTINCT ${c}) AS ${a}`),
      avg: (c, a) => push(`AVG(${c}) AS ${a}`),
      min: (c, a) => push(`MIN(${c}) AS ${a}`),
      max: (c, a) => push(`MAX(${c}) AS ${a}`),
      argMax: (c, arg, a) => push(`argMax(${c}, ${arg}) AS ${a}`),
      argMin: (c, arg, a) => push(`argMin(${c}, ${arg}) AS ${a}`),
      quantile: (c, level, a) => push(`quantile(${level})(${c}) AS ${a}`),
      stddev: (c, a) => push(`stddevSamp(${c}) AS ${a}`),
      variance: (c, a) => push(`varSamp(${c}) AS ${a}`),
      where: (c, op) => { state.where.push(`${c} ${op} ?`); return builder; },
      groupBy: (args) => { state.groupBy.push(...(Array.isArray(args) ? args : [args])); return builder; },
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => {
        const sql = buildSql();
        queries.push(sql);
        return { sql, parameters: [] };
      },
      execute: async () => [],
    };
    return builder;
  }
  return { factory: { table: (name: string) => createBuilder(name), rawQuery: async () => [] }, queries };
}

// ---------------------------------------------------------------------------
// Helper validation
// ---------------------------------------------------------------------------

describe('analytical measure helpers', () => {
  it('normalizes median to percentile 0.5', () => {
    expect(measure.median('amount')).toMatchObject({ aggregation: 'percentile', level: 0.5 });
    expect(median('amount')).toMatchObject({ aggregation: 'percentile', level: 0.5 });
  });

  it('rejects percentile levels outside [0, 1]', () => {
    expect(() => measure.percentile('amount', 1.5)).toThrow('between 0 and 1');
    expect(() => measure.percentile('amount', -0.1)).toThrow('between 0 and 1');
    expect(() => measure.percentile('amount', Number.NaN)).toThrow('between 0 and 1');
    expect(() => percentile('amount', 2)).toThrow('between 0 and 1');
  });

  it('captures the by-field on argMax/argMin', () => {
    expect(measure.argMax('status', 'createdAt')).toMatchObject({ aggregation: 'argMax', field: 'status', argField: 'createdAt' });
    expect(argMaxAgg('status', 'createdAt')).toMatchObject({ aggregation: 'argMax', argField: 'createdAt' });
  });

  it('creates stddev/variance specs', () => {
    expect(measure.stddev('amount')).toMatchObject({ aggregation: 'stddev' });
    expect(stddevAgg('amount')).toMatchObject({ aggregation: 'stddev' });
  });
});

// ---------------------------------------------------------------------------
// Metric validation
// ---------------------------------------------------------------------------

describe('analytical metric validation', () => {
  it('allows percentile metrics over numeric dimensions', () => {
    expect(() => Orders.metric('p95', { measure: 'p95Amount' })).not.toThrow();
  });

  it('allows argMax metrics over numeric dimensions', () => {
    expect(() => Orders.metric('latest', { measure: 'latestAmount' })).not.toThrow();
  });

  it('rejects argMax metrics over non-numeric dimensions', () => {
    expect(() => Orders.metric('latestStatusMetric', { measure: 'latestStatus' }))
      .toThrow(/argMax\(\) requires a numeric dimension/);
  });
});

// ---------------------------------------------------------------------------
// In-memory backend execution
// ---------------------------------------------------------------------------

describe('analytical measures on the in-memory backend', () => {
  const client = createDatasetClient({ backend: createInMemoryBackend(tables) });

  it('computes percentile and median', async () => {
    const { data } = await client.execute(Orders, { measures: ['p95Amount', 'medianAmount'] });
    // amounts [10,20,30,40,50]: p95 = 40 + 0.8*(50-40) = 48; median = 30
    expect(data).toEqual([{ p95Amount: 48, medianAmount: 30 }]);
  });

  it('computes argMax/argMin including non-numeric fields', async () => {
    const { data } = await client.execute(Orders, {
      measures: ['latestAmount', 'firstAmount', 'latestStatus'],
    });
    expect(data).toEqual([{ latestAmount: 50, firstAmount: 10, latestStatus: 'cancelled' }]);
  });

  it('computes sample stddev and variance', async () => {
    const { data } = await client.execute(Orders, { measures: ['amountStddev', 'amountVariance'] });
    // sample variance of [10..50] = 250; stddev = sqrt(250)
    expect(data[0].amountVariance).toBeCloseTo(250, 6);
    expect(data[0].amountStddev).toBeCloseTo(Math.sqrt(250), 6);
  });

  it('applies measure filters to percentile', async () => {
    const { data } = await client.execute(Orders, { measures: ['completedP95'] });
    // completed amounts [10,20,40]: p95 = 20 + 0.9*(40-20) = 38
    expect(data[0].completedP95).toBeCloseTo(38, 6);
  });

  it('groups analytical measures by dimension', async () => {
    const { data } = await client.execute(Orders, {
      dimensions: ['status'],
      measures: ['latestAmount', 'medianAmount'],
      orderBy: [{ field: 'status', direction: 'asc' }],
    });
    expect(data).toEqual([
      { status: 'cancelled', latestAmount: 50, medianAmount: 50 },
      { status: 'completed', latestAmount: 40, medianAmount: 20 },
      { status: 'pending', latestAmount: 30, medianAmount: 30 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Query-builder path SQL
// ---------------------------------------------------------------------------

describe('analytical measures on the query-builder path', () => {
  it('renders quantile, argMax, and stddev SQL with resolved columns', () => {
    const { factory } = createSqlCapturingFactory();
    const client = createDatasetClient({ queryBuilder: factory });

    const sql = client.toSQL(Orders, {
      dimensions: ['status'],
      measures: ['p95Amount', 'latestAmount', 'amountStddev'],
    });

    expect(sql).toContain('quantile(0.95)(amount) AS p95Amount');
    // createdAt resolves to its physical column
    expect(sql).toContain('argMax(amount, created_at) AS latestAmount');
    expect(sql).toContain('stddevSamp(amount) AS amountStddev');
    expect(sql).toContain('GROUP BY status');
  });

  it('wraps filtered percentile in a NULL-fallback condition', () => {
    const { factory } = createSqlCapturingFactory();
    const client = createDatasetClient({ queryBuilder: factory });

    const sql = client.toSQL(Orders, { measures: ['completedP95'] });
    expect(sql).toContain("quantile(0.95)(if((status = 'completed'), amount, NULL)) AS completedP95");
  });

  it('rejects measure filters on argMax at planning time', () => {
    const { factory } = createSqlCapturingFactory();
    const client = createDatasetClient({ queryBuilder: factory });
    const FilteredArg = dataset('filteredArg', {
      source: 'orders',
      dimensions: Orders.dimensions,
      measures: {
        // Hand-rolled definition bypasses the helper's compile-time guard.
        bad: {
          __type: 'measure_definition' as const,
          aggregation: 'argMax' as const,
          field: 'amount',
          argField: 'createdAt',
          filters: [{ field: 'status', operator: 'eq' as const, value: 'completed' }],
        },
      },
    });

    expect(() => client.toSQL(FilteredArg, { measures: ['bad'] }))
      .toThrow('Measure filters are not supported on argMax aggregations.');
  });
});

// ---------------------------------------------------------------------------
// Catalog / contract surfacing
// ---------------------------------------------------------------------------

describe('analytical measures in catalog and contract', () => {
  it('surfaces argField and level in the catalog', () => {
    const catalog = getDatasetCatalog(Orders);
    expect(catalog.measures.p95Amount).toMatchObject({ aggregation: 'percentile', level: 0.95 });
    expect(catalog.measures.latestStatus).toMatchObject({ aggregation: 'argMax', argField: 'createdAt' });
  });

  it('surfaces argField and level in the semantic contract', () => {
    const contract = serializeSemanticContract({ orders: Orders });
    const measures = contract.datasets.orders.measures;
    expect(measures.p95Amount).toMatchObject({ aggregation: 'percentile', level: 0.95 });
    expect(measures.latestAmount).toMatchObject({ aggregation: 'argMax', argField: 'createdAt' });
    // Fields stay absent for classic aggregations, keeping existing hashes stable.
    expect('level' in measures.medianAmount ? measures.medianAmount.level : undefined).toBe(0.5);
    expect('argField' in contract.datasets.orders.measures.amountStddev).toBe(false);
  });
});
