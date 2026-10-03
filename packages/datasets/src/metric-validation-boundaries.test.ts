import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import type { MetricQuery } from './types.js';
import { belongsTo } from './relationships.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

const Customer = dataset('customer', { source: 'customer', dimensions: { country: dimension.string() } });
const Sales = dataset('sales', {
  source: 'sales', dimensions: { amount: dimension.number(), country: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  filters: { amount: { field: 'amount' }, country: { field: 'country', operators: ['eq'] } },
  relationships: { customer: belongsTo(() => Customer, { from: 'customer_id', to: 'id' }) },
  limits: { maxDimensions: 1, maxFilters: 1, maxResultSize: 10 },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });

describe('metric validation boundaries', () => {
  it.each([
    [{ limit: -1 }, 'Invalid limit'], [{ limit: 1.5 }, 'Invalid limit'],
    [{ offset: -1 }, 'Invalid offset'], [{ offset: 1.5 }, 'Invalid offset'],
    [{ limit: 11 }, 'Too many results'],
    [{ dimensions: ['amount', 'country'] }, 'Too many dimensions'],
    [{ dimensions: ['unknown.country'] }, 'Unknown relationship'],
    [{ filters: [{ field: 'country', operator: 'like', value: 'x%' }] }, 'does not allow operator'],
    [{ filters: [{ field: 'amount', operator: 'eq', value: 'bad' }] }, 'number'],
    [{ filters: [{ field: 'unknown.country', operator: 'eq', value: 'US' }] }, 'Unknown relationship'],
    [{ filters: [{ field: 'amount', operator: 'eq', value: 1 }, { field: 'amount', operator: 'eq', value: 2 }] }, 'Too many filters'],
    [{ by: 'day' }, 'has no timeKey'],
  ] satisfies [MetricQuery, string][])('rejects invalid metric query %j consistently', (query, error) => {
    expect(client.validate(Revenue, query).errors.join('; ')).toContain(error);
    expect(() => client.toSQL(Revenue, query)).toThrow(error);
  });

  it('accepts related dimensions and filters, zero pagination and boundary limits', () => {
    expect(client.validate(Revenue, {
      dimensions: ['customer.country'], filters: [{ field: 'customer.country', operator: 'eq', value: 'US' }],
      limit: 10, offset: 0,
    }).valid).toBe(true);
    expect(client.validate(Revenue, { limit: 0, offset: 0 }).valid).toBe(true);
  });
});
