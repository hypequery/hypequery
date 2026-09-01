import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildMCPQuerySchemas } from './canonical-query-schemas.js';

describe('MCP canonical query schemas', () => {
  it('uses one catalog compiler for advertised schemas and runtime parsing', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { status: dimension.string() },
      measures: { revenue: measure.sum('amount') },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
    const schemas = buildMCPQuerySchemas({
      orders: { ...Orders, metrics: { totalRevenue } },
    });

    expect(schemas.queryDatasetJsonSchema.properties?.dimensions.items?.enum)
      .toEqual(['status']);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['missing'],
    }).success).toBe(false);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
    }).success).toBe(true);
    expect(schemas.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => ListToolsResultSchema.parse({
      tools: [
        {
          name: 'query_dataset',
          description: 'Query a dataset',
          inputSchema: schemas.queryDatasetJsonSchema,
        },
        {
          name: 'query_metric',
          description: 'Query a metric',
          inputSchema: schemas.queryMetricJsonSchema,
        },
      ],
    })).not.toThrow();
  });

  it('preserves generic validation for legacy metadata-only registries', () => {
    const schemas = buildMCPQuerySchemas({
      orders: { dimensions: { status: {} }, metrics: {} },
    });

    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['status'],
    }).success).toBe(true);
  });

  it('keeps exact schemas when a registry also contains a legacy entry', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { status: dimension.string() },
      measures: { revenue: measure.sum('amount') },
    });
    const schemas = buildMCPQuerySchemas({
      orders: Orders,
      legacy: { dimensions: { arbitrary: {} }, metrics: {} },
    });

    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['missing'],
    }).success).toBe(false);
    expect(schemas.queryDataset.safeParse({
      dataset: 'legacy',
      dimensions: ['arbitrary'],
    }).success).toBe(true);
  });
});
