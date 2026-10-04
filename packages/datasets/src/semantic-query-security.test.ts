import { expect, it, vi } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide, nullIfZero } from './formulas.js';
import { createDatasetClient } from './executor.js';
import { belongsTo } from './relationships.js';
import type { DatasetQuery, MetricQuery } from './types.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { semanticOrderDirection } from './utils/semantic-query-syntax.js';

const Customers = dataset('customers', {
  source: 'customers', tenantKey: 'tenant', dimensions: { id: dimension.number() },
});
const Sales = dataset('sales', {
  source: 'sales', tenantKey: 'tenant', dimensions: { id: dimension.number(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount'), count: measure.count('id') },
  filters: { id: { field: 'id' }, opaque: { field: 'physical_column' } },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const Average = Sales.metric('average', {
  uses: { revenue: Revenue, count: Sales.metric('count', { measure: 'count' }) },
  formula: ({ revenue, count }) => divide(revenue, nullIfZero(count)),
});
const context = { runtime: { tenant: 'A' } };

it.each([Sales, Revenue, Average])('rejects raw SQL filter operators before builder use: $name', target => {
  const factory = createRenderingBuilderFactory();
  const table = vi.spyOn(factory, 'table');
  const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });
  for (const field of ['id', 'opaque', 'customer.id']) {
    for (const operator of ['inSubquery', 'globalInSubquery', 'inTable', 'unknown']) {
      const query = { filters: [{ field, operator, value: 'SELECT id FROM sales) OR 1=1 --' }] } as unknown as DatasetQuery & MetricQuery;
      expect(client.validate(target, query, context).valid).toBe(false);
      expect(() => client.toSQL(target, query, context)).toThrow('Unsupported semantic filter operator');
      expect(() => client.execute(target, query, context)).toThrow('Unsupported semantic filter operator');
      if (target === Sales) expect(() => client.compileDataset(Sales, query, context)).toThrow('Unsupported semantic filter operator');
    }
  }
  expect(table).not.toHaveBeenCalled();
});

it.each([Sales, Revenue, Average])('rejects unsafe ordering before builder use: $name', target => {
  const factory = createRenderingBuilderFactory();
  const table = vi.spyOn(factory, 'table');
  const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });
  const field = target === Average ? 'average' : 'revenue';
  for (const direction of ['asc UNION ALL SELECT SUM(amount) FROM sales', 'ASC', '', null]) {
    const query = { orderBy: [{ field, direction }] } as unknown as DatasetQuery & MetricQuery;
    expect(client.validate(target, query, context).valid).toBe(false);
    expect(() => client.toSQL(target, query, context)).toThrow('Invalid order direction');
    expect(() => client.execute(target, query, context)).toThrow('Invalid order direction');
  }
  expect(table).not.toHaveBeenCalled();
});

it('uses only closed SQL direction mappings', () => {
  expect(semanticOrderDirection('asc')).toBe('ASC');
  expect(semanticOrderDirection('desc')).toBe('DESC');
  expect(() => semanticOrderDirection('asc UNION SELECT 1')).toThrow('Invalid order direction');
});
