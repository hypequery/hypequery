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

  it('does not advertise dimensions as filterable when a dataset opts out of filters', () => {
    const NoFilters = dataset('orders_no_filters', {
      source: 'orders',
      dimensions: { status: dimension.string() },
      filters: {},
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
      },
    });
    const schema = buildDatasetInputSchema(NoFilters);

    // The runtime validator rejects unqualified filters not declared in
    // ds.filters, so the schema must not advertise them either.
    expect(schema.safeParse({
      filters: [{ field: 'status', operator: 'eq', value: 'x' }],
    }).success).toBe(false);
    expect(schema.safeParse({
      filters: [{ field: 'customer.country', operator: 'eq', value: 'US' }],
    }).success).toBe(true);
  });

  it('falls back to plain strings when no filter fields are known', () => {
    const Bare = dataset('bare', {
      source: 'bare',
      dimensions: { id: dimension.string() },
      filters: {},
    });

    // Superset-safe: with no known fields the schema stays permissive and the
    // runtime validator produces the precise error.
    expect(buildDatasetInputSchema(Bare).safeParse({
      filters: [{ field: 'anything', operator: 'eq', value: 1 }],
    }).success).toBe(true);
  });
});
