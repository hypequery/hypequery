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
import { resolveDatasetSqlDialect } from './utils/dataset-sql-dialect.js';

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
    const { factory } = trackedFactory();
    expect(toQueryBuilderFactory(factory)).toBe(factory);
    expect(resolveDatasetSqlDialect(toQueryBuilderFactory(factory)))
      .toBe(factory.datasetSqlDialect);
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
    expect(sql).toContain('GROUP BY "customer.country"');
    expect(sql).toContain('ORDER BY "customer.country" ASC');
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
