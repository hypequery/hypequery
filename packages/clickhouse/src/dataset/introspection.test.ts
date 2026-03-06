/**
 * Tests for Dataset Introspection API
 */

import { describe, it, expect } from 'vitest';
import {
  introspectDimension,
  introspectMetric,
  getDatasetSchema,
  listDatasets,
  getAllDatasetSchemas,
  summarizeDataset,
  datasetsToJSON,
  summarizeAllDatasets,
} from './introspection';
import { sql } from './sql-tag';
import { dimension, metric } from './helpers';
import type { DatasetsMap } from './types';

// Test datasets
const testDatasets: DatasetsMap = {
  orders: {
    name: 'orders',
    description: 'Customer orders and revenue data',
    table: 'orders',
    dimensions: {
      region: dimension.string('region', {
        description: 'Geographic region',
        examples: ['US', 'EU', 'APAC'],
      }),
      date: dimension.date(sql`DATE(created_at)`, {
        description: 'Order date',
        examples: ['2024-01-15', '2024-02-01'],
      }),
      amount: dimension.number('amount', {
        description: 'Order amount',
      }),
    },
    metrics: {
      revenue: metric.sum('amount', {
        description: 'Total revenue',
        format: 'currency',
      }),
      orderCount: metric.count({
        description: 'Total number of orders',
      }),
      avgOrderValue: metric.avg('amount', {
        description: 'Average order value',
        format: 'currency',
      }),
    },
    tenant: {
      column: 'merchant_id',
      required: true,
    },
    limits: {
      maxDimensions: 10,
      maxMetrics: 20,
    },
  },
  customers: {
    name: 'customers',
    description: 'Customer data',
    table: 'customers',
    dimensions: {
      id: dimension.string('id', { description: 'Customer ID' }),
      country: dimension.string('country', {
        description: 'Country code',
        examples: ['US', 'UK', 'FR'],
      }),
    },
    metrics: {
      totalCustomers: metric.count({ description: 'Total customers' }),
    },
  },
};

describe('introspectDimension', () => {
  it('should introspect a simple string dimension', () => {
    const dim = dimension.string('region', {
      description: 'Geographic region',
      examples: ['US', 'EU'],
    });

    const introspected = introspectDimension(dim);

    expect(introspected.type).toBe('string');
    expect(introspected.description).toBe('Geographic region');
    expect(introspected.examples).toEqual(['US', 'EU']);
    expect(introspected.sql).toBe('region');
  });

  it('should introspect a SQL expression dimension', () => {
    const dim = dimension.date(sql`DATE(created_at)`, {
      description: 'Order date',
    });

    const introspected = introspectDimension(dim);

    expect(introspected.type).toBe('date');
    expect(introspected.description).toBe('Order date');
    expect(introspected.sql).toBe('DATE(created_at)');
  });

  it('should handle dimensions without examples', () => {
    const dim = dimension.number('amount', {
      description: 'Order amount',
    });

    const introspected = introspectDimension(dim);

    expect(introspected.type).toBe('number');
    expect(introspected.examples).toBeUndefined();
  });

  it('should handle simple column reference', () => {
    const introspected = introspectDimension('region');

    expect(introspected.type).toBe('string');
    expect(introspected.sql).toBe('region');
    expect(introspected.description).toBeUndefined();
  });
});

describe('introspectMetric', () => {
  it('should introspect a sum metric', () => {
    const m = metric.sum('amount', {
      description: 'Total revenue',
      format: 'currency',
    });

    const introspected = introspectMetric(m);

    expect(introspected.type).toBe('number');
    expect(introspected.aggregationType).toBe('sum');
    expect(introspected.description).toBe('Total revenue');
    expect(introspected.format).toBe('currency');
    expect(introspected.sql).toBe('amount');
  });

  it('should introspect a count metric', () => {
    const m = metric.count({
      description: 'Total orders',
    });

    const introspected = introspectMetric(m);

    expect(introspected.type).toBe('number');
    expect(introspected.aggregationType).toBe('count');
    expect(introspected.description).toBe('Total orders');
  });

  it('should introspect a custom metric', () => {
    const m = metric.custom(sql`sum(amount) / count(DISTINCT customer_id)`, {
      description: 'Revenue per customer',
      format: 'currency',
    });

    const introspected = introspectMetric(m);

    expect(introspected.type).toBe('number');
    expect(introspected.aggregationType).toBe('custom');
    expect(introspected.sql).toBe('sum(amount) / count(DISTINCT customer_id)');
  });
});

describe('getDatasetSchema', () => {
  it('should get complete schema for a dataset', () => {
    const schema = getDatasetSchema(testDatasets, 'orders');

    expect(schema.name).toBe('orders');
    expect(schema.description).toBe('Customer orders and revenue data');
    expect(schema.table).toBe('orders');

    // Check dimensions
    expect(schema.dimensions.region).toBeDefined();
    expect(schema.dimensions.region.type).toBe('string');
    expect(schema.dimensions.region.description).toBe('Geographic region');
    expect(schema.dimensions.region.examples).toEqual(['US', 'EU', 'APAC']);

    expect(schema.dimensions.date).toBeDefined();
    expect(schema.dimensions.date.type).toBe('date');
    expect(schema.dimensions.date.sql).toBe('DATE(created_at)');

    // Check metrics
    expect(schema.metrics.revenue).toBeDefined();
    expect(schema.metrics.revenue.type).toBe('number');
    expect(schema.metrics.revenue.aggregationType).toBe('sum');
    expect(schema.metrics.revenue.format).toBe('currency');

    expect(schema.metrics.orderCount).toBeDefined();
    expect(schema.metrics.orderCount.aggregationType).toBe('count');

    // Check tenant config
    expect(schema.tenantRequired).toBe(true);

    // Check limits
    expect(schema.limits).toBeDefined();
    expect(schema.limits?.maxDimensions).toBe(10);
    expect(schema.limits?.maxMetrics).toBe(20);
  });

  it('should throw for non-existent dataset', () => {
    expect(() => getDatasetSchema(testDatasets, 'unknown')).toThrow(/not found/);
  });
});

describe('listDatasets', () => {
  it('should list all dataset names', () => {
    const names = listDatasets(testDatasets);

    expect(names).toContain('orders');
    expect(names).toContain('customers');
    expect(names.length).toBe(2);
  });
});

describe('getAllDatasetSchemas', () => {
  it('should get schemas for all datasets', () => {
    const schemas = getAllDatasetSchemas(testDatasets);

    expect(schemas.orders).toBeDefined();
    expect(schemas.orders.name).toBe('orders');

    expect(schemas.customers).toBeDefined();
    expect(schemas.customers.name).toBe('customers');

    expect(Object.keys(schemas).length).toBe(2);
  });
});

describe('summarizeDataset', () => {
  it('should generate markdown summary for a dataset', () => {
    const summary = summarizeDataset(testDatasets, 'orders');

    expect(summary).toContain('# Dataset: orders');
    expect(summary).toContain('Customer orders and revenue data');

    // Dimensions section
    expect(summary).toContain('## Dimensions');
    expect(summary).toContain('region (string)');
    expect(summary).toContain('Geographic region');
    expect(summary).toContain('Examples: US, EU, APAC');

    expect(summary).toContain('date (date)');
    expect(summary).toContain('Order date');

    // Metrics section
    expect(summary).toContain('## Metrics');
    expect(summary).toContain('revenue (sum)');
    expect(summary).toContain('Total revenue');
    expect(summary).toContain('Format: currency');

    expect(summary).toContain('orderCount (count)');

    // Constraints section
    expect(summary).toContain('## Constraints');
    expect(summary).toContain('Multi-tenancy: Required');
    expect(summary).toContain('Max dimensions: 10');
    expect(summary).toContain('Max metrics: 20');
  });

  it('should handle datasets without constraints', () => {
    const summary = summarizeDataset(testDatasets, 'customers');

    expect(summary).toContain('# Dataset: customers');
    expect(summary).toContain('## Dimensions');
    expect(summary).toContain('## Metrics');
    expect(summary).not.toContain('## Constraints');
  });
});

describe('datasetsToJSON', () => {
  it('should convert datasets to JSON', () => {
    const json = datasetsToJSON(testDatasets);
    const parsed = JSON.parse(json);

    expect(parsed.orders).toBeDefined();
    expect(parsed.orders.name).toBe('orders');
    expect(parsed.orders.dimensions.region).toBeDefined();
    expect(parsed.orders.metrics.revenue).toBeDefined();

    expect(parsed.customers).toBeDefined();
  });

  it('should produce valid JSON', () => {
    const json = datasetsToJSON(testDatasets);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('summarizeAllDatasets', () => {
  it('should summarize all datasets', () => {
    const summaries = summarizeAllDatasets(testDatasets);

    expect(summaries.length).toBe(2);

    const ordersSummary = summaries.find((s) => s.name === 'orders');
    expect(ordersSummary).toBeDefined();
    expect(ordersSummary?.description).toBe('Customer orders and revenue data');
    expect(ordersSummary?.dimensionCount).toBe(3);
    expect(ordersSummary?.metricCount).toBe(3);

    const customersSummary = summaries.find((s) => s.name === 'customers');
    expect(customersSummary).toBeDefined();
    expect(customersSummary?.description).toBe('Customer data');
    expect(customersSummary?.dimensionCount).toBe(2);
    expect(customersSummary?.metricCount).toBe(1);
  });
});
