/**
 * The gate for decision 0005.
 *
 * Portable native execution is only safe if a catalog rebuilt from a deployment
 * contract plans exactly the same SQL as the catalog it was built from. If a
 * case in this corpus cannot be made byte-identical, that surface is excluded
 * from portable execution — `CORE-12` must reject it with an explicit
 * unsupported-capability error — rather than being documented and accepted.
 *
 * Test-only. The corpus is generated rather than hand-listed so the axes the
 * decision names (dimension subsets, measure combinations, filter operators,
 * time grains, ordering, pagination, joins, tenant predicates) are covered
 * combinatorially instead of by example.
 *
 * Each case is compared on the SQL it compiles to *or* the refusal it produces:
 * a rebuilt catalog that accepts a query the authored one rejects has diverged
 * just as surely as one that emits different SQL.
 *
 * Known blind spot: a metric's advertised `grains` list is not enforced by
 * `validate`/`toSQL` — a metric advertising only `day` still compiles `by:
 * month`. Narrowing that list therefore cannot change SQL, so this harness
 * cannot detect drift in it. Portable execution is not at risk (nothing depends
 * on the list to plan), but the agent-safe catalog does publish it, so an agent
 * can be told a metric supports fewer grains than it accepts. Enforcing it
 * belongs with the exact-schema work in MCP-105, not here.
 */

import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { eq } from './query-helpers.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';
import { belongsTo } from './relationships.js';
import type { MetricHandle, TimeGrain } from './types.js';

// ---------------------------------------------------------------------------
// A faithful renderer. Values are inlined rather than parameterized so one
// string carries both the shape of the query and the values bound into it —
// a divergence in either is then a divergence in the compared artifact.
// ---------------------------------------------------------------------------

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) return `(${value.map(literal).join(', ')})`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const OPERATORS: Record<string, string> = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  in: 'IN', notIn: 'NOT IN', like: 'LIKE', between: 'BETWEEN',
};

function condition(column: string, operator: string, value: unknown): string {
  const rendered = OPERATORS[operator] ?? operator.toUpperCase();
  if (operator === 'between' && Array.isArray(value)) {
    return `${column} BETWEEN ${literal(value[0])} AND ${literal(value[1])}`;
  }
  return `${column} ${rendered} ${literal(value)}`;
}

function createRenderingBuilderFactory(): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const select: string[] = [];
    const joins: string[] = [];
    const where: string[] = [];
    const groupBy: string[] = [];
    const orderBy: string[] = [];
    let limit: number | undefined;
    let offset: number | undefined;

    const agg = (fn: string) => (column: string, alias?: string) => {
      select.push(`${fn}(${column}) AS ${alias ?? `${column}_${fn.toLowerCase()}`}`);
      return builder;
    };
    const join = (keyword: string) => (
      joinTable: string,
      leftColumn: string,
      rightColumn: string,
      alias?: string,
      on?: { column: string; operator: string; value: unknown }
        | { column: string; operator: string; value: unknown }[],
    ) => {
      const conditions = on === undefined ? [] : (Array.isArray(on) ? on : [on]);
      const extra = conditions
        .map(entry => ` AND ${condition(entry.column, entry.operator, entry.value)}`)
        .join('');
      joins.push(
        `${keyword} ${alias ? `${joinTable} AS ${alias}` : joinTable} `
        + `ON ${leftColumn} = ${rightColumn}${extra}`,
      );
      return builder;
    };

    const builder: QueryBuilderLike = {
      select: columns => {
        select.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      sum: agg('SUM'),
      count: agg('COUNT'),
      countDistinct: (column, alias) => {
        select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
        return builder;
      },
      avg: agg('AVG'),
      min: agg('MIN'),
      max: agg('MAX'),
      argMax: (column, argColumn, alias) => {
        select.push(`argMax(${column}, ${argColumn}) AS ${alias ?? `${column}_argMax`}`);
        return builder;
      },
      argMin: (column, argColumn, alias) => {
        select.push(`argMin(${column}, ${argColumn}) AS ${alias ?? `${column}_argMin`}`);
        return builder;
      },
      quantile: (column, level, alias) => {
        select.push(`quantile(${level})(${column}) AS ${alias ?? `${column}_quantile`}`);
        return builder;
      },
      stddev: agg('stddevSamp'),
      variance: agg('varSamp'),
      where: (column, operator, value) => {
        where.push(condition(column, operator, value));
        return builder;
      },
      leftJoin: join('LEFT JOIN'),
      leftAnyJoin: join('LEFT ANY JOIN'),
      groupBy: columns => {
        groupBy.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      orderBy: (column, direction) => {
        orderBy.push(`${column} ${direction ?? 'ASC'}`);
        return builder;
      },
      limit: count => { limit = count; return builder; },
      offset: count => { offset = count; return builder; },
      toSQLWithParams: () => {
        let sql = `SELECT ${select.length > 0 ? select.join(', ') : '*'} FROM ${table}`;
        if (joins.length > 0) sql += ` ${joins.join(' ')}`;
        if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
        if (groupBy.length > 0) sql += ` GROUP BY ${groupBy.join(', ')}`;
        if (orderBy.length > 0) sql += ` ORDER BY ${orderBy.join(', ')}`;
        if (limit !== undefined) sql += ` LIMIT ${limit}`;
        if (offset !== undefined) sql += ` OFFSET ${offset}`;
        return { sql, parameters: [] };
      },
      execute: async () => [],
    };
    return builder;
  }

  return { table: createBuilder, rawQuery: async () => [] };
}

// ---------------------------------------------------------------------------
// A model exercising every contract feature portable execution must preserve.
// ---------------------------------------------------------------------------

const Customers = dataset('customers', {
  source: 'analytics.customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number({ column: 'customer_id' }),
    country: dimension.string({ column: 'country_code', label: 'Country' }),
    tier: dimension.string(),
  },
});

const Orders = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    customerId: dimension.number({ column: 'customer_id' }),
    status: dimension.string(),
    region: dimension.string({ sql: 'upper(region_code)', dependencies: ['region_code'] }),
    channel: dimension.string({ column: 'channel_code' }),
    amount: dimension.number({ column: 'amount_cents', groupable: false }),
    units: dimension.number({ column: 'unit_count', groupable: false }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue' }),
    orderCount: measure.count('status'),
    uniqueCustomers: measure.countDistinct('customerId'),
    avgAmount: measure.avg('amount'),
    minAmount: measure.min('amount'),
    maxAmount: measure.max('amount'),
    paidRevenue: measure.sum('amount', { filters: [eq('status', 'paid')] }),
    topRegion: measure.argMax('region', 'amount'),
    bottomRegion: measure.argMin('region', 'amount'),
    p95Amount: measure.percentile('amount', 0.95),
    amountStddev: measure.stddev('amount'),
    amountVariance: measure.variance('amount'),
    // A SQL-overriding measure on its own field: sharing `amount` with
    // `revenue` would make the two indistinguishable in the contract, which
    // rehydration correctly refuses rather than guesses at.
    rawUnits: measure.sum('units', { sql: 'sum(unit_count) / 2', dependencies: ['unit_count'] }),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn', 'like'] },
    createdAt: { __type: 'filter_definition', field: 'createdAt', operators: ['gt', 'gte', 'lt', 'lte', 'between'] },
    region: { __type: 'filter_definition', field: 'region', operators: ['eq', 'in'] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
  limits: { maxDimensions: 6, maxMeasures: 8, maxFilters: 6, maxResultSize: 5_000 },
});

const PUBLIC_ENDPOINT = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;

const authoredMetrics: Record<string, MetricHandle> = {
  totalRevenue: Orders.metric('totalRevenue', { measure: 'revenue' }) as MetricHandle,
  monthlyRevenue: (Orders.metric('monthlyRevenue', { measure: 'revenue' }) as unknown as {
    by(grain: TimeGrain): MetricHandle;
  }).by('month'),
  paidRevenue: Orders.metric('paidRevenue', { measure: 'paidRevenue' }) as MetricHandle,
};

const contracts = [
  buildProtocolDatasetContract(Customers as never, { endpoint: PUBLIC_ENDPOINT as never }),
  buildProtocolDatasetContract(Orders as never, {
    endpoint: PUBLIC_ENDPOINT as never,
    metrics: authoredMetrics as never,
    metricEndpoints: Object.fromEntries(
      Object.keys(authoredMetrics).map(name => [name, PUBLIC_ENDPOINT]),
    ) as never,
  }),
];

const rehydrated = rehydrateProtocolDatasets(contracts);

const authoredClient = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
const rehydratedClient = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];
const GROUPABLE = ['createdAt', 'customerId', 'status', 'region', 'channel'];
const MEASURES = Object.keys(Orders.measures);
const TENANTS = [
  { label: 'single tenant', runtime: 'acme' },
  { label: 'tenant object', runtime: { id: 'acme' } },
  { label: 'tenant list', runtime: { in: ['acme', 'globex'] } },
  { label: 'all tenants', runtime: { scope: 'all' as const } },
];

interface Case {
  readonly name: string;
  readonly query: Record<string, unknown>;
  readonly tenant?: unknown;
  readonly metric?: string;
}

function subsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [
    ...subsets(rest, size - 1).map(tail => [head, ...tail]),
    ...subsets(rest, size),
  ];
}

function corpus(): Case[] {
  const cases: Case[] = [];

  // Dimension subsets, every size, against a fixed measure.
  for (const size of [1, 2, 3]) {
    for (const dimensions of subsets(GROUPABLE, size)) {
      cases.push({
        name: `dimensions ${dimensions.join('+')}`,
        query: { dimensions, measures: ['revenue'] },
      });
    }
  }

  // Every measure alone, then pairs, so aggregation rendering is covered.
  for (const name of MEASURES) {
    cases.push({ name: `measure ${name}`, query: { dimensions: ['status'], measures: [name] } });
  }
  for (const pair of subsets(MEASURES, 2).slice(0, 40)) {
    cases.push({ name: `measures ${pair.join('+')}`, query: { dimensions: ['status'], measures: pair } });
  }

  // Every declared filter operator against a compatible value.
  const filterValues: Record<string, unknown[]> = {
    eq: ['paid'], neq: ['refunded'], in: [['paid', 'pending']], notIn: [['refunded']],
    like: ['pa%'], gt: ['2026-01-01'], gte: ['2026-01-01'], lt: ['2026-02-01'],
    lte: ['2026-02-01'], between: [['2026-01-01', '2026-02-01']],
  };
  for (const [field, definition] of Object.entries(Orders.filters)) {
    for (const operator of definition.operators ?? []) {
      for (const value of filterValues[operator] ?? []) {
        cases.push({
          name: `filter ${field} ${operator}`,
          query: {
            dimensions: ['status'],
            measures: ['revenue'],
            filters: [{ field, operator, value }],
          },
        });
      }
    }
  }

  // Time grains.
  for (const grain of GRAINS) {
    cases.push({ name: `grain ${grain}`, query: { measures: ['revenue'], by: grain } });
    cases.push({
      name: `grain ${grain} with dimension`,
      query: { dimensions: ['status'], measures: ['revenue'], by: grain },
    });
  }

  // Ordering, both directions, over dimensions and measures.
  for (const field of ['status', 'revenue', 'period']) {
    for (const direction of ['asc', 'desc'] as const) {
      cases.push({
        name: `order ${field} ${direction}`,
        query: {
          dimensions: ['status'],
          measures: ['revenue'],
          ...(field === 'period' ? { by: 'month' as TimeGrain } : {}),
          orderBy: [{ field, direction }],
        },
      });
    }
  }

  // Pagination.
  for (const [limit, offset] of [[10, 0], [50, 50], [1, 999], [5_000, 0]]) {
    cases.push({
      name: `page limit=${limit} offset=${offset}`,
      query: { dimensions: ['status'], measures: ['revenue'], limit, offset },
    });
  }

  // Joins over the to-one relationship, including a joined filter and ordering.
  cases.push(
    { name: 'join dimension', query: { dimensions: ['customer.country'], measures: ['revenue'] } },
    {
      name: 'join with local dimension',
      query: { dimensions: ['status', 'customer.tier'], measures: ['revenue'] },
    },
    {
      name: 'join filtered',
      query: {
        dimensions: ['customer.country'],
        measures: ['revenue'],
        filters: [{ field: 'customer.country', operator: 'eq', value: 'GB' }],
      },
    },
    {
      name: 'join ordered',
      query: {
        dimensions: ['customer.country'],
        measures: ['revenue'],
        orderBy: [{ field: 'customer.country', direction: 'desc' }],
      },
    },
  );

  // Tenant predicates, including the joined-tenant case.
  for (const tenant of TENANTS) {
    cases.push({
      name: `tenant ${tenant.label}`,
      query: { dimensions: ['status'], measures: ['revenue'] },
      tenant: tenant.runtime,
    });
    cases.push({
      name: `tenant ${tenant.label} over a join`,
      query: { dimensions: ['customer.country'], measures: ['revenue'] },
      tenant: tenant.runtime,
    });
  }

  // Named metrics, including a grained one and one with a fixed measure filter.
  for (const metric of Object.keys(authoredMetrics)) {
    cases.push({ name: `metric ${metric}`, query: {}, metric });
    cases.push({
      name: `metric ${metric} grouped`,
      query: { dimensions: ['status'] },
      metric,
    });
    // Exercises the metric's declared grain list, not just its pinned grain:
    // a rehydration that narrowed `grains` would still emit identical SQL for
    // the grains it kept, and only diverge on the ones it dropped.
    for (const grain of GRAINS) {
      cases.push({
        name: `metric ${metric} by ${grain}`,
        query: { by: grain },
        metric,
      });
    }
    cases.push({
      name: `metric ${metric} filtered and paged`,
      query: {
        dimensions: ['status'],
        filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
        limit: 25,
        offset: 5,
      },
      metric,
    });
  }

  return cases;
}

const CASES = corpus();

/**
 * Compiles a case to the artifact it should be compared on: the SQL, or the
 * refusal. A rebuilt catalog that accepted a query the authored one rejects —
 * or rejected it for a different reason — has diverged just as surely as one
 * that emitted different SQL, so both outcomes are compared.
 */
function compile(
  client: ReturnType<typeof createDatasetClient>,
  target: unknown,
  testCase: Case,
): string {
  // Both datasets are tenant-scoped and correctly refuse to compile without a
  // tenant, so every case carries one; the tenant axis varies it explicitly.
  try {
    return `SQL ${client.toSQL(
      target as never,
      testCase.query as never,
      { runtime: { tenant: (testCase.tenant ?? 'acme') as never } },
    )}`;
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe('rehydrated catalogs emit byte-identical SQL', () => {
  it('covers every axis decision 0005 names', () => {
    // Guards the corpus itself: a refactor that silently dropped an axis would
    // otherwise leave this suite passing on a fraction of the surface.
    const names = CASES.map(entry => entry.name);
    for (const axis of ['dimensions ', 'measure ', 'filter ', 'grain ', 'order ', 'page ', 'join ', 'tenant ', 'metric ']) {
      expect(names.filter(name => name.startsWith(axis)).length).toBeGreaterThan(0);
    }
    expect(CASES.length).toBeGreaterThan(120);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CASES)('$name', testCase => {
    const authoredTarget = testCase.metric === undefined
      ? Orders
      : authoredMetrics[testCase.metric];
    const rehydratedTarget = testCase.metric === undefined
      ? rehydrated.orders
      : rehydrated.orders.metrics[testCase.metric];

    const authoredSql = compile(authoredClient, authoredTarget, testCase);
    const rehydratedSql = compile(rehydratedClient, rehydratedTarget, testCase);

    expect(rehydratedSql).toBe(authoredSql);
  });

  it('compiles real SQL rather than an empty string', () => {
    // A harness that compared two empty strings would pass every case above.
    const sql = compile(authoredClient, Orders, {
      name: 'sanity',
      query: { dimensions: ['status', 'customer.country'], measures: ['revenue'], limit: 10 },
      tenant: 'acme',
    });

    expect(sql.startsWith('SQL ')).toBe(true);
    expect(sql).toContain('FROM analytics.orders');
    expect(sql).toContain('SUM(');
    expect(sql).toContain('JOIN');
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('LIMIT 10');
  });

  it('detects a divergence the corpus is meant to catch', () => {
    // Proves the comparison has teeth: a dataset whose column mapping differs
    // by one field must not compare equal.
    const drifted = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      timeKey: 'createdAt',
      dimensions: {
        createdAt: dimension.timestamp({ column: 'created_at' }),
        status: dimension.string({ column: 'status_code' }),
      },
      measures: { revenue: measure.sum('createdAt') },
    });
    const query = { name: 'drift', query: { dimensions: ['status'], measures: ['revenue'] } };

    expect(compile(rehydratedClient, drifted, query))
      .not.toBe(compile(authoredClient, Orders, query));
  });
});
