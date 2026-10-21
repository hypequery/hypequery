import { describe, expect, it, vi } from 'vitest';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { divide, nullIfZero } from './formulas.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import { toQueryBuilderFactory, type QueryBuilderFactoryLike } from './query-builder-protocol.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';
import { completeDatasetSqlDialect, resolveDatasetSqlDialect } from './utils/dataset-sql-dialect.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { country: dimension.string() },
});
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { amount: dimension.number(), id: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('id'),
    average: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});
const Revenue = Orders.metric('revenueMetric', { measure: 'revenue' });
const Average = Orders.metric('averageMetric', {
  uses: { revenue: Revenue, orders: Orders.metric('ordersMetric', { measure: 'orders' }) },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
});

function trackedFactory() {
  const quoteIdentifier = vi.fn(clickhouseDatasetSqlDialect.quoteIdentifier);
  const factory: QueryBuilderFactoryLike = {
    ...createRenderingBuilderFactory(),
    datasetSqlDialect: { name: 'clickhouse', quoteIdentifier },
  };
  return { factory, quoteIdentifier };
}

describe('datasets SQL dialect seam', () => {
  it('defaults legacy factories to the shared ClickHouse implementation', () => {
    expect(resolveDatasetSqlDialect(createRenderingBuilderFactory()))
      .toBe(clickhouseDatasetSqlDialect);
    expect(clickhouseDatasetSqlDialect.quoteIdentifier('customer.country'))
      .toBe('`customer.country`');
    expect(clickhouseDatasetSqlDialect.quoteIdentifier('odd`name')).toBe('`odd``name`');
    expect(Object.isFrozen(clickhouseDatasetSqlDialect)).toBe(true);
  });

  it('preserves factory metadata through structural adaptation', () => {
    const { factory, quoteIdentifier } = trackedFactory();
    expect(toQueryBuilderFactory(factory)).toBe(factory);
    const rules = resolveDatasetSqlDialect(toQueryBuilderFactory(factory));
    expect(resolveDatasetSqlDialect(factory)).toBe(rules);
    expect(rules.name).toBe('clickhouse');
    expect(rules.quoteIdentifier('x')).toBe('`x`');
    expect(quoteIdentifier).toHaveBeenCalledWith('x');
  });

  it('completes a partial hook with the ClickHouse rules it does not override', () => {
    const hook = { name: 'custom', quoteIdentifier: (identifier: string) => `[${identifier}]` };
    const rules = completeDatasetSqlDialect(hook);
    expect(completeDatasetSqlDialect(hook)).toBe(rules);
    expect(completeDatasetSqlDialect(clickhouseDatasetSqlDialect)).toBe(clickhouseDatasetSqlDialect);
    expect(Object.isFrozen(rules)).toBe(true);
    expect(rules.name).toBe('custom');
    expect(rules.quoteIdentifier('a')).toBe('[a]');
    expect(rules.truncateTime('t', 'day')).toBe(clickhouseDatasetSqlDialect.truncateTime('t', 'day'));
  });

  it('keeps prototype methods of a class-based hook', () => {
    class BracketDialect {
      readonly name = 'brackets';
      quoteIdentifier(identifier: string) { return `[${identifier}]`; }
    }
    expect(completeDatasetSqlDialect(new BracketDialect()).quoteIdentifier('a')).toBe('[a]');
  });

  it('applies the hook to time-measure and relationship SQL', () => {
    const Events = dataset('events', {
      source: 'events',
      timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }), status: dimension.string(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
        ratio: measure.derived({
          uses: { rolling: 'rolling', revenue: 'revenue' },
          formula: ({ rolling, revenue }) => divide(revenue, nullIfZero(rolling)),
        }),
      },
    });
    const factory: QueryBuilderFactoryLike = {
      ...createRenderingBuilderFactory(),
      datasetSqlDialect: { name: 'clickhouse', quoteIdentifier: identifier => `"${identifier}"` },
    };
    const client = createDatasetClient({ queryBuilder: factory });
    const sql = client.toSQL(Events, {
      by: 'day',
      dimensions: ['status'],
      measures: ['rolling', 'ratio'],
      filters: [{ field: 'time', operator: 'between', value: ['2026-01-01', '2026-02-01'] }],
    });
    expect(sql).toContain('AS "status"');
    expect(sql).toContain('AS "rolling"');
    expect(sql).toContain('ORDER BY "period" ASC');
    expect(sql).not.toContain('`');
    expect(client.toSQL(Orders, { dimensions: ['customer.country'], measures: ['revenue'] }))
      .toContain('AS "customer.country"');
  });

  it('uses the hook result in derived selections, references and ordering', () => {
    const factory: QueryBuilderFactoryLike = {
      ...createRenderingBuilderFactory(),
      datasetSqlDialect: {
        name: 'clickhouse',
        quoteIdentifier: identifier => `"${identifier.replace(/"/g, '""')}"`,
      },
    };
    const sql = createDatasetClient({ queryBuilder: factory }).toSQL(Orders, {
      measures: ['average'],
      dimensions: ['customer.country'],
      orderBy: [{ field: 'average', direction: 'desc' }],
    });
    expect(sql).toContain('AS "customer.country"');
    expect(sql).toContain('"revenue"');
    expect(sql).toContain('AS "average"');
    expect(sql).toContain('ORDER BY "average" DESC');
    expect(sql).not.toContain('`');
  });

  it('keeps legacy SQL identical across datasets, base metrics and derived metrics', () => {
    const legacy = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    const { factory, quoteIdentifier } = trackedFactory();
    const explicit = createDatasetClient({ queryBuilder: factory });
    const dimensions = ['customer.country'];
    const orderBy = [{ field: 'customer.country', direction: 'asc' as const }];

    expect(explicit.toSQL(Orders, { measures: ['average'], dimensions, orderBy }))
      .toBe(legacy.toSQL(Orders, { measures: ['average'], dimensions, orderBy }));
    expect(explicit.toSQL(Revenue, { dimensions, orderBy }))
      .toBe(legacy.toSQL(Revenue, { dimensions, orderBy }));
    expect(explicit.toSQL(Average, { dimensions, orderBy }))
      .toBe(legacy.toSQL(Average, { dimensions, orderBy }));
    expect(quoteIdentifier).toHaveBeenCalledWith('customer.country');
    expect(quoteIdentifier).toHaveBeenCalledWith('revenue');
    expect(quoteIdentifier).toHaveBeenCalledWith('average');
  });

  it.each(['revenue', 'average'])('uses the runtime dialect in compilation previews and execution: %s', async selected => {
    const factory: QueryBuilderFactoryLike = {
      ...createRenderingBuilderFactory(),
      datasetSqlDialect: {
        name: 'clickhouse',
        quoteIdentifier: identifier => `"${identifier.replace(/"/g, '""')}"`,
      },
    };
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    const context = { runtime: { builderFactory: factory } };
    const query = {
      measures: [selected],
      dimensions: ['customer.country'],
      orderBy: [{ field: 'customer.country', direction: 'asc' as const }],
      limit: 2,
    };
    const compilation = client.compileDataset(Orders, query, context);

    expect(compilation.sql).toContain('AS "customer.country"');
    // A derived measure orders its outer SELECT by the CTE column; a base
    // measure repeats the guarded join expression (the GROUP BY key).
    const orderKey = compilation.sql.includes('FROM base') ? '"customer.country"' : 'if(isNotNull(customer._hq_match), customer.country, NULL)';
    expect(compilation.sql).toContain(`ORDER BY ${orderKey} ASC`);
    expect(compilation.sql).not.toContain('`');
    expect(compilation.describe().executionLimit).toBe(3);
    expect((await client.execute(Orders, query, context)).meta.sql).toBe(compilation.sql);
    expect(client.compileDataset(Orders, query).sql).toContain('`customer.country`');
  });

  it.each([Revenue, Average])('preserves custom quoted SQL through metric execution: $name', async target => {
    const factory: QueryBuilderFactoryLike = {
      ...createRenderingBuilderFactory(),
      datasetSqlDialect: {
        name: 'clickhouse',
        quoteIdentifier: identifier => `"${identifier.replace(/"/g, '""')}"`,
      },
    };
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    const context = { runtime: { builderFactory: factory } };
    const query = {
      dimensions: ['customer.country'],
      orderBy: [{ field: 'customer.country', direction: 'asc' as const }],
    };
    const sql = client.toSQL(target, query, context);

    expect(sql).toContain('AS "customer.country"');
    expect(sql).toContain('GROUP BY if(isNotNull(customer._hq_match), customer.country, NULL)');
    const orderKey = sql.includes('FROM base') ? '"customer.country"' : 'if(isNotNull(customer._hq_match), customer.country, NULL)';
    expect(sql).toContain(`ORDER BY ${orderKey} ASC`);
    expect(sql).not.toContain('`');
    expect((await client.execute(target, query, context)).meta.sql).toBe(sql);

    const defaultSql = client.toSQL(target, query);
    expect(defaultSql).toContain('`customer.country`');
    expect(defaultSql).not.toBe(sql);
  });

  it('uses the runtime factory dialect for compilation and execution, then restores the default', async () => {
    const defaults = trackedFactory();
    const override = trackedFactory();
    const client = createDatasetClient({ queryBuilder: defaults.factory });
    const context = { runtime: { builderFactory: override.factory } };
    const query = { measures: ['average'], dimensions: ['customer.country'] };
    const rawQuery = vi.spyOn(override.factory, 'rawQuery');

    client.toSQL(Orders, query, context);
    await client.execute(Orders, query, context);
    client.toSQL(Revenue, { dimensions: query.dimensions }, context);
    await client.execute(Revenue, { dimensions: query.dimensions }, context);
    client.toSQL(Average, { dimensions: query.dimensions }, context);
    await client.execute(Average, { dimensions: query.dimensions }, context);

    expect(defaults.quoteIdentifier).not.toHaveBeenCalled();
    expect(override.quoteIdentifier).toHaveBeenCalledWith('customer.country');
    expect(rawQuery).toHaveBeenCalledTimes(2);

    override.quoteIdentifier.mockClear();
    client.toSQL(Orders, query);
    expect(defaults.quoteIdentifier).toHaveBeenCalledWith('customer.country');
    expect(override.quoteIdentifier).not.toHaveBeenCalled();
  });

  it('falls back to ClickHouse when a runtime override has no dialect metadata', () => {
    const defaults = trackedFactory();
    const override = createRenderingBuilderFactory();
    const client = createDatasetClient({ queryBuilder: defaults.factory });
    const query = { measures: ['average'] };
    expect(client.toSQL(Orders, query, { runtime: { builderFactory: override } }))
      .toBe(createDatasetClient({ queryBuilder: override }).toSQL(Orders, query));
    expect(defaults.quoteIdentifier).not.toHaveBeenCalled();
  });
});
