import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { buildDatasetInputSchema, buildMetricInputSchema } from './semantic-query-schema.js';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  segments: {
    paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] },
    open: { filters: [{ field: 'status', operator: 'eq', value: 'open' }] },
  },
});

const Plain = dataset('plain', {
  source: 'plain',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

describe('segment input schemas', () => {
  it('accepts only the segment names a dataset declares', () => {
    const schema = buildDatasetInputSchema(Orders);
    expect(schema.safeParse({ measures: ['revenue'], segments: ['paid', 'open'] }).success).toBe(true);
    expect(schema.safeParse({ measures: ['revenue'], segments: ['refunded'] }).success).toBe(false);

    const metric = Orders.metric('revenue', { measure: 'revenue' });
    const metricSchema = buildMetricInputSchema({ ...Orders, metrics: { revenue: metric } }, 'revenue');
    expect(metricSchema.safeParse({ segments: ['paid'] }).success).toBe(true);
  });

  it('leaves the schema of a dataset without segments unchanged', () => {
    const schema = buildDatasetInputSchema(Plain);
    expect(schema.safeParse({ measures: ['revenue'], segments: ['paid'] }).success).toBe(false);
    expect(schema.safeParse({ measures: ['revenue'] }).success).toBe(true);
  });
});
