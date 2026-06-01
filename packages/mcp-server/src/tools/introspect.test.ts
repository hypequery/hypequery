/**
 * Unit tests for get-dataset-schema tool
 */

import { describe, it, expect } from 'vitest';
import { getDatasetSchemaTool } from './introspect.js';

describe('getDatasetSchemaTool', () => {
  it('should throw error when dataset parameter is missing', async () => {
    await expect(getDatasetSchemaTool({}, {})).rejects.toThrow(
      'dataset parameter is required'
    );
  });

  it('should throw error when dataset is not found', async () => {
    await expect(
      getDatasetSchemaTool({}, { dataset: 'nonexistent' })
    ).rejects.toThrow('Dataset not found: nonexistent');
  });

  it('should return complete schema for dataset', async () => {
    const datasets = {
      orders: {
        description: 'Order data',
        source: 'orders_table',
        timeKey: 'order_date',
        tenantKey: 'company_id',
        dimensions: {
          customerId: {
            type: 'string',
            column: 'customer_id',
            label: 'Customer ID',
            description: 'Unique customer identifier',
            examples: ['CUST001', 'CUST002'],
          },
          region: {
            type: 'string',
            column: 'region',
            label: 'Region',
            description: 'Sales region',
          },
        },
        metrics: {
          revenue: {
            type: 'sum',
            aggregation: 'sum',
            label: 'Total Revenue',
            description: 'Sum of all order amounts',
            format: 'currency',
          },
          count: {
            type: 'count',
            label: 'Order Count',
          },
        },
        relationships: {
          customer: {
            type: 'many-to-one',
            target: 'customers',
            description: 'Related customer',
          },
        },
      },
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'orders' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.name).toBe('orders');
    expect(schema.description).toBe('Order data');
    expect(schema.source).toBe('orders_table');
    expect(schema.timeKey).toBe('order_date');
    expect(schema.tenantKey).toBe('company_id');

    expect(schema.dimensions.customerId).toMatchObject({
      type: 'string',
      column: 'customer_id',
      label: 'Customer ID',
      description: 'Unique customer identifier',
      examples: ['CUST001', 'CUST002'],
    });

    expect(schema.dimensions.region).toMatchObject({
      type: 'string',
      column: 'region',
      label: 'Region',
      description: 'Sales region',
      examples: [],
    });

    expect(schema.metrics.revenue).toMatchObject({
      type: 'sum',
      aggregation: 'sum',
      label: 'Total Revenue',
      description: 'Sum of all order amounts',
      format: 'currency',
    });

    expect(schema.metrics.count).toMatchObject({
      type: 'count',
      label: 'Order Count',
      description: '',
      format: null,
    });

    expect(schema.relationships.customer).toMatchObject({
      type: 'many-to-one',
      target: 'customers',
      description: 'Related customer',
    });
  });

  it('should handle dataset with config structure', async () => {
    const datasets = {
      events: {
        config: {
          description: 'Event data',
          source: 'events_table',
          timeKey: 'timestamp',
        },
        dimensions: {},
        metrics: {},
      },
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'events' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.description).toBe('Event data');
    expect(schema.source).toBe('events_table');
    expect(schema.timeKey).toBe('timestamp');
  });

  it('should handle minimal dataset', async () => {
    const datasets = {
      minimal: {},
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'minimal' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.name).toBe('minimal');
    expect(schema.description).toBe('');
    expect(schema.source).toBe('');
    expect(schema.timeKey).toBeNull();
    expect(schema.tenantKey).toBeNull();
    expect(schema.dimensions).toEqual({});
    expect(schema.metrics).toEqual({});
    expect(schema.relationships).toEqual({});
  });

  it('should use dimension name as default column', async () => {
    const datasets = {
      test: {
        dimensions: {
          status: {
            type: 'string',
          },
        },
        metrics: {},
      },
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'test' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.dimensions.status.column).toBe('status');
  });

  it('should use dimension name as default label', async () => {
    const datasets = {
      test: {
        dimensions: {
          customerId: {
            type: 'string',
          },
        },
        metrics: {},
      },
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'test' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.dimensions.customerId.label).toBe('customerId');
  });

  it('should handle empty examples array by default', async () => {
    const datasets = {
      test: {
        dimensions: {
          field: {
            type: 'string',
          },
        },
        metrics: {},
      },
    };

    const result = await getDatasetSchemaTool(datasets, { dataset: 'test' });
    const schema = JSON.parse(result.content[0].text);

    expect(schema.dimensions.field.examples).toEqual([]);
  });
});
