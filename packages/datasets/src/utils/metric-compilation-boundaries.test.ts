import { describe, expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import { createRenderingBuilderFactory } from '../tests/support/sql-equality-harness.js';
import { buildMetricQueryBuilder } from './metric-query-builder.js';
import { buildDerivedMetricSql } from './metric-derived-query.js';

const Sales = dataset('sales', {
  source: 'sales', tenantKey: 'tenant',
  dimensions: { tenant: dimension.string(), amount: dimension.number(), country: dimension.string() },
  measures: { revenue: measure.sum('amount'), orders: measure.count('amount') },
  segments: { domestic: { filters: [{ field: 'country', operator: 'eq', value: 'US' }] } },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const Average = Sales.metric('average', {
  uses: { revenue: Revenue, orders: Sales.metric('orders', { measure: 'orders' }) },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
});
const factory = createRenderingBuilderFactory();
const context = { runtime: { tenant: 't1' } };

describe('independent metric compilers', () => {
  it('applies segments inside the derived CTE and orders the outer metric output', () => {
    const client = createDatasetClient({ queryBuilder: factory });
    const sql = client.toSQL(Average, {
      segments: ['domestic'], dimensions: ['country'],
      orderBy: [{ field: 'average', direction: 'desc' }], limit: 10, offset: 2,
    }, context);
    expect(sql).toContain("country = 'US'");
    expect(sql).toContain("tenant = 't1'");
    expect(sql).toContain('GROUP BY country');
    expect(sql).toContain('SELECT country,');
    expect(sql).toContain('ORDER BY average DESC LIMIT 10 OFFSET 2');
  });

  it('refuses tenant filters even when called independently of client validation', () => {
    const query = { filters: [{ field: 'tenant', operator: 'eq' as const, value: 'other' }] };
    expect(() => buildMetricQueryBuilder(Revenue, Revenue.spec, Sales, query, undefined, factory, context))
      .toThrow('Cannot filter on tenant field');
    expect(() => buildDerivedMetricSql(Average, Average.spec, query, undefined, factory, context))
      .toThrow('Cannot filter on tenant field');
  });
});
