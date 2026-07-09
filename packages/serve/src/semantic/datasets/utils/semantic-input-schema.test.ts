import { describe, expect, it } from 'vitest';
import {
  belongsTo,
  dataset,
  dimension,
  hasMany,
  measure,
} from '@hypequery/datasets';
import {
  buildDatasetInputSchema,
  buildMetricInputSchema,
} from './semantic-input-schema.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
    country: dimension.string(),
    computed: dimension.string({ sql: 'upper(country)' }),
  },
});

const Items = dataset('items', {
  source: 'items',
  dimensions: {
    sku: dimension.string(),
  },
});

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    id: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
    items: hasMany(() => Items, { from: 'id', to: 'order_id' }),
  },
});

describe('relationship-aware semantic input schemas', () => {
  it('accepts queryable relationship fields for dataset queries', () => {
    const result = buildDatasetInputSchema(Orders).safeParse({
      dimensions: ['customer.country'],
      measures: ['revenue'],
      filters: [{ field: 'customer.country', operator: 'eq', value: 'US' }],
      orderBy: [{ field: 'customer.country', direction: 'asc' }],
    });

    expect(result.success).toBe(true);
  });

  it('excludes hasMany and SQL-backed target dimensions', () => {
    const schema = buildDatasetInputSchema(Orders);

    expect(schema.safeParse({ dimensions: ['items.sku'] }).success).toBe(false);
    expect(schema.safeParse({ dimensions: ['customer.computed'] }).success).toBe(false);
  });

  it('accepts queryable relationship fields for metric queries', () => {
    const result = buildMetricInputSchema(Orders, 'revenue').safeParse({
      dimensions: ['customer.country'],
      filters: [{ field: 'customer.country', operator: 'eq', value: 'US' }],
      orderBy: [{ field: 'customer.country', direction: 'asc' }],
    });

    expect(result.success).toBe(true);
  });
});
