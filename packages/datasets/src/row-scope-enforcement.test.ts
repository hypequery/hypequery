/**
 * Row-scope enforcement across every query shape (RFC 0020, phase 1).
 *
 * Each builder-path shape reads its source through `scopedDatasetSource`. This
 * suite compiles every shape under a runtime tenant and an enforced constraint
 * and asserts that every read of the source carries both, and that every join
 * of a tenant-scoped target carries the target's tenant predicate. A shape
 * that reads the source another way fails here.
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { divide, nullIfZero, subtract } from './formulas.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { datasetCacheKey, metricCacheKey } from './cache/protocol-cache-keys.js';
import type { DatasetQuery, ExecutionContext, MetricFilter, MetricHandle, TimeGrain } from './types.js';

const Customers = dataset('customers', {
  source: 'analytics.customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number({ column: 'customer_id' }),
    country: dimension.string({ column: 'country_code' }),
    tier: dimension.string(),
  },
  measures: { customers: measure.countDistinct('id') },
});

const Orders = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    customerId: dimension.number({ column: 'customer_id' }),
    status: dimension.string(),
    channel: dimension.string({ column: 'sales_channel' }),
    amount: dimension.number({ column: 'amount_cents', groupable: false }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    running: measure.cumulative('revenue'),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
    monthOverMonth: measure.derived({
      uses: { current: 'revenue', prior: 'priorMonth' },
      formula: ({ current, prior }) => subtract(current, prior),
    }),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
    channel: { __type: 'filter_definition', field: 'channel', operators: ['eq', 'in'] },
    createdAt: { __type: 'filter_definition', field: 'createdAt', operators: ['gte', 'lt', 'between'] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});

const revenueInput = Orders.metric('revenue', { measure: 'revenue' });
const ordersInput = Orders.metric('orders', { measure: 'orders' });
const metrics: Record<string, MetricHandle> = {
  'metric': Orders.metric('totalRevenue', { measure: 'revenue' }) as MetricHandle,
  'metric by grain': (Orders.metric('monthlyRevenue', { measure: 'revenue' }) as unknown as {
    by(grain: TimeGrain): MetricHandle;
  }).by('month'),
  'derived metric': Orders.metric('aov', {
    uses: { revenue: revenueInput, orders: ordersInput },
    formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
  }) as MetricHandle,
};

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });
const CONSTRAINT: MetricFilter = { field: 'channel', operator: 'eq', value: '__constrained__' };
const SCOPED: ExecutionContext = { runtime: { tenant: 'acme', constraints: [CONSTRAINT] } };
const RANGE: MetricFilter[] = [{ field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-04-01'] }];

const shapes: Record<string, DatasetQuery> = {
  'aggregate': { dimensions: ['status'], measures: ['revenue'], filters: [{ field: 'status', operator: 'eq', value: 'paid' }] },
  'aggregate by grain': { by: 'month', measures: ['revenue'] },
  'derived': { dimensions: ['status'], measures: ['averageOrderValue'] },
  'having': { dimensions: ['customerId'], measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gt', value: 100 }] },
  'window': { by: 'day', measures: ['rolling', 'running'], filters: RANGE },
  'shift': { by: 'month', measures: ['revenue', 'priorMonth'], filters: RANGE },
  'composite shift formula': { by: 'month', measures: ['monthOverMonth'], filters: RANGE },
  'relationship join': { dimensions: ['customer.country'], measures: ['revenue'] },
  'relationship measure': { dimensions: ['status'], measures: ['revenue', 'customer.customers'] },
  'relationship filter': { measures: ['revenue'], filters: [{ field: 'customer.tier', operator: 'eq', value: 'gold' }] },
  'relationship window': { by: 'day', dimensions: ['customer.country'], measures: ['rolling'], filters: RANGE },
};

function count(sql: string, pattern: RegExp): number {
  return sql.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
}

/** Every source read is scoped; every tenant-scoped join is scoped in its ON clause. */
function expectScoped(sql: string, parameters?: readonly unknown[]): void {
  const reads = count(sql, /FROM analytics\.orders\b/);
  expect(reads).toBeGreaterThan(0);
  expect(count(sql, /WHERE (analytics\.orders\.)?tenant_id = \? AND (analytics\.orders\.)?sales_channel = \?/)).toBe(reads);
  expect(count(sql, /FROM `analytics`\.`customers`/)).toBe(count(sql, /customer\.tenant_id = \?/));
  if (parameters) {
    expect(parameters.filter(value => value === '__constrained__')).toHaveLength(reads);
  }
}

describe('row scope: every query shape applies the tenant and enforced constraints', () => {
  it.each(Object.entries(shapes))('dataset %s', (_name, query) => {
    const compilation = client.compileDataset(Orders, query as never, SCOPED);
    for (const statement of [compilation, ...(compilation.preflightStatements ?? [])]) {
      expectScoped(statement.sql, statement.parameters);
    }
  });

  it('covers every emission plan', () => {
    const plans = new Set(Object.values(shapes).map(query => client.compileDataset(Orders, query as never, SCOPED).describe().plan));
    expect([...plans].sort()).toEqual(['aggregate', 'derived', 'time']);
  });

  it.each(Object.entries(metrics))('%s', (_name, metric) => {
    expectScoped(client.toSQL(metric as never, { dimensions: ['status'] } as never, SCOPED));
    expectScoped(client.toSQL(metric as never, { dimensions: ['customer.country'] } as never, SCOPED));
  });

  it('applies a relationship-field constraint through a join the query did not ask for', () => {
    const sql = client.toSQL(Orders, { measures: ['revenue'] } as never, {
      runtime: { tenant: 'acme', constraints: [{ field: 'customer.tier', operator: 'eq', value: 'gold' }] },
    });
    expect(sql).toContain('LEFT ANY JOIN');
    expect(sql).toContain('customer.tenant_id = ?');
    expect(sql).toMatch(/WHERE analytics\.orders\.tenant_id = \? AND if\(isNotNull\(customer\._hq_match\), customer\.tier, NULL\) = \?/);
  });

  it('applies constraints with the trusted cross-tenant scope', () => {
    const sql = client.toSQL(Orders, { measures: ['revenue'] } as never, {
      runtime: { tenant: { scope: 'all' }, constraints: [CONSTRAINT] },
    });
    expect(sql).toContain('WHERE analytics.orders.sales_channel = ?');
    expect(sql).not.toContain('tenant_id');
  });

  it('leaves SQL unchanged when no constraints are supplied', () => {
    const query = { dimensions: ['status'], measures: ['revenue'] } as never;
    expect(client.toSQL(Orders, query, { runtime: { tenant: 'acme', constraints: [] } }))
      .toBe(client.toSQL(Orders, query, { runtime: { tenant: 'acme' } }));
  });
});

describe('enforced constraints fail closed', () => {
  const query = { measures: ['revenue'] } as never;
  const refused = (constraints: unknown) => () => client.toSQL(Orders, query, {
    runtime: { tenant: 'acme', constraints: constraints as MetricFilter[] },
  });
  const unenforceable = 'Dataset "orders" cannot enforce a runtime constraint.';

  it.each([
    ['an unknown field', [{ field: 'secret', operator: 'eq', value: 'x' }]],
    ['an undeclared filter on a real dimension', [{ field: 'amount', operator: 'eq', value: 1 }]],
    ['a disallowed operator', [{ field: 'channel', operator: 'like', value: '%' }]],
    ['an unsupported operator', [{ field: 'channel', operator: 'raw', value: '1=1' }]],
    ['a wrong value type', [{ field: 'channel', operator: 'in', value: 'web' }]],
    ['an unknown relationship', [{ field: 'merchant.tier', operator: 'eq', value: 'x' }]],
    ['a prototype key', [{ field: 'constructor', operator: 'eq', value: 'x' }]],
    ['a non-array', { field: 'channel', operator: 'eq', value: 'web' }],
    ['more than 32 constraints', Array.from({ length: 33 }, () => CONSTRAINT)],
  ])('refuses %s without describing it', (_name, constraints) => {
    expect(refused(constraints)).toThrow(unenforceable);
    try {
      refused(constraints)();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/secret|amount|merchant|channel|constructor/);
    }
  });

  it('refuses at execution before any SQL runs', async () => {
    await expect(async () => client.execute(Orders, query, {
      runtime: { tenant: 'acme', constraints: [{ field: 'secret', operator: 'eq', value: 'x' }] },
    })).rejects.toThrow(unenforceable);
  });

  it('still requires the runtime tenant', () => {
    expect(() => client.toSQL(Orders, query, { runtime: { constraints: [CONSTRAINT] } }))
      .toThrow('requires runtime tenant scoping');
  });

  it('requires tenant runtime when a constraint joins a tenant-scoped target', () => {
    const Events = dataset('events', {
      source: 'analytics.events',
      dimensions: { customerId: dimension.number({ column: 'customer_id' }) },
      measures: { events: measure.count('customerId') },
      relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }) },
    });
    expect(() => client.toSQL(Events, { measures: ['events'] } as never, {
      runtime: { constraints: [{ field: 'customer.tier', operator: 'eq', value: 'gold' }] },
    })).toThrow('requires runtime tenant scoping');
  });

  it('shares the filter ceiling with the caller', () => {
    const Limited = dataset('limited', {
      source: 'analytics.orders',
      dimensions: { channel: dimension.string({ column: 'sales_channel' }) },
      measures: { orders: measure.count('channel') },
      limits: { maxFilters: 2 },
    });
    const constraints = [{ field: 'channel', operator: 'eq' as const, value: 'web' }];
    const filters = [
      { field: 'channel', operator: 'neq' as const, value: 'a' },
      { field: 'channel', operator: 'neq' as const, value: 'b' },
    ];
    expect(() => client.toSQL(Limited, { measures: ['orders'], filters: filters.slice(0, 1) } as never, { runtime: { constraints } }))
      .not.toThrow();
    expect(() => client.toSQL(Limited, { measures: ['orders'], filters } as never, { runtime: { constraints } }))
      .toThrow('Too many filters');
    expect(() => client.toSQL(Limited, { measures: ['orders'] } as never, { runtime: { constraints: [...constraints, ...constraints, ...constraints] } }))
      .toThrow('cannot enforce a runtime constraint');
  });

  it('refuses constraints on the deprecated backend path', async () => {
    const backendClient = createDatasetClient({ backend: createInMemoryBackend({ tables: {} }) });
    await expect(async () => backendClient.execute(Orders, query, { runtime: { tenant: 'acme', constraints: [CONSTRAINT] } }))
      .rejects.toThrow('Enforced constraints require the queryBuilder execution path.');
  });
});

describe('enforced constraints enter the cache key', () => {
  const settings = { secret: new Uint8Array(32).fill(7), project: 'p', environment: 'e', keyVersion: 1 } as never;
  const query: DatasetQuery = { dimensions: ['status'], measures: ['revenue'] };
  const key = (constraints?: MetricFilter[], filters?: MetricFilter[]) =>
    datasetCacheKey(settings, Orders, { ...query, ...(filters ? { filters } : {}) }, { runtime: { tenant: 'acme', constraints } }, undefined);

  it('partitions entries by constraint value', () => {
    const a = key([{ field: 'channel', operator: 'eq', value: 'web' }]);
    const b = key([{ field: 'channel', operator: 'eq', value: 'store' }]);
    expect(a).toBeDefined();
    expect(a).not.toBe(b);
    expect(a).not.toBe(key());
  });

  it('keeps existing keys when there are no constraints', () => {
    expect(key([])).toBe(key());
  });

  it('shares an entry with an identical caller filter, which yields the same rows', () => {
    const filter: MetricFilter = { field: 'channel', operator: 'eq', value: 'web' };
    expect(key([filter])).toBe(key(undefined, [filter]));
  });

  it('partitions metric entries by constraint value', () => {
    const metric = metrics.metric;
    const metricKey = (value: string) =>
      metricCacheKey(settings, metric as never, {}, { runtime: { tenant: 'acme', constraints: [{ field: 'channel', operator: 'eq', value }] } }, undefined);
    expect(metricKey('web')).not.toBe(metricKey('store'));
  });

  it('cannot be changed by mutating the context after execute is called', async () => {
    const executed: unknown[][] = [];
    const recording = createQueryBuilder({ host: 'http://localhost:8123' });
    const spy = {
      ...recording,
      table: (name: string) => wrap(recording.table(name)),
    };
    function wrap(qb: any): any {
      return new Proxy(qb, {
        get(target, prop, receiver) {
          if (prop === 'execute') {
            return async () => { executed.push(target.toSQLWithParams().parameters); return []; };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function'
            ? (...args: unknown[]) => { const result = value.apply(target, args); return result && typeof result === 'object' && 'toSQLWithParams' in result ? wrap(result) : result; }
            : value;
        },
      });
    }
    const local = createDatasetClient({ queryBuilder: spy as never });
    const constraints = [{ field: 'channel', operator: 'eq' as const, value: 'web' }];
    const pending = local.execute(Orders, query as never, { runtime: { tenant: 'acme', constraints } });
    constraints[0].value = 'store';
    await pending;
    expect(executed.flat()).toContain('web');
    expect(executed.flat()).not.toContain('store');
  });
});
