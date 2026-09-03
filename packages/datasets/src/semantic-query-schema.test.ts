import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import {
  buildCanonicalSemanticQuerySchemas,
  buildDatasetInputSchema,
  toSemanticJsonSchema,
} from './semantic-query-schema.js';
import { getDatasetCatalog, type DatasetCatalog } from './catalog.js';
import type { MetricFilter } from './types.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq', 'in'],
    },
  },
  limits: {
    maxDimensions: 2,
    maxFilters: 3,
    maxResultSize: 500,
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const registry = { orders: { ...Orders, metrics: { totalRevenue } } };

describe('canonical semantic query schemas', () => {
  it('uses exact catalog fields and field-specific operators at runtime', () => {
    const schemas = buildCanonicalSemanticQuerySchemas(registry, { grainField: 'grain' });

    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['status'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
      grain: 'day',
    }).success).toBe(true);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['missing'],
    }).success).toBe(false);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['status'],
      filters: [{ field: 'status', operator: 'like', value: '%' }],
    }).success).toBe(false);
  });

  it('closes nested objects and requires a dataset selection', () => {
    const schemas = buildCanonicalSemanticQuerySchemas(registry, { grainField: 'grain' });

    expect(schemas.queryDataset.safeParse({ dataset: 'orders' }).success).toBe(false);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      dimensions: ['status'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid', injected: true }],
    }).success).toBe(false);
    expect(schemas.queryDatasetJsonSchema.allOf).toBeDefined();
  });

  it('emits integer and collection ceilings into the JSON schema', () => {
    const schemas = buildCanonicalSemanticQuerySchemas(registry, { grainField: 'grain' });
    const properties = schemas.queryDatasetJsonSchema.properties;

    expect(properties?.dimensions.maxItems).toBe(2);
    expect(properties?.filters.maxItems).toBe(3);
    expect(properties?.limit).toMatchObject({ type: 'integer', maximum: 500 });
    expect(properties?.offset).toMatchObject({ type: 'integer', maximum: 10_000 });
  });

  it('can apply a consumer-specific default result size', () => {
    const schema = buildDatasetInputSchema(Orders, {
      defaultResultSize: 25,
      maxResultSize: 50,
    });

    expect(schema.parse({ dimensions: ['status'] })).toMatchObject({ limit: 25 });
    expect(toSemanticJsonSchema(schema).properties?.limit)
      .toMatchObject({ maximum: 50, default: 25 });
  });

  it('emits exact dataset/metric pairs and a deterministic manifest hash', () => {
    const first = buildCanonicalSemanticQuerySchemas(registry, { grainField: 'grain' });
    const second = buildCanonicalSemanticQuerySchemas({
      orders: { ...Orders, metrics: { totalRevenue } },
    }, { grainField: 'grain' });

    expect(first.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
    }).success).toBe(true);
    expect(first.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'missing',
    }).success).toBe(false);
    expect(first.queryDataset.safeParse({
      dataset: 'orders',
      measures: ['revenue'],
      orderBy: [{ field: 'totalRevenue', direction: 'desc' }],
    }).success).toBe(false);
    expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.manifestHash).toBe(first.manifestHash);
  });

  it('compiles the same manifest from an already-normalized hosted catalog', () => {
    const local = buildCanonicalSemanticQuerySchemas(registry, { grainField: 'grain' });
    const hosted = buildCanonicalSemanticQuerySchemas({
      orders: getDatasetCatalog(registry.orders),
    }, { grainField: 'grain' });

    expect(hosted.queryDatasetJsonSchema).toEqual(local.queryDatasetJsonSchema);
    expect(hosted.queryMetricJsonSchema).toEqual(local.queryMetricJsonSchema);
    expect(hosted.manifestHash).toBe(local.manifestHash);
  });

  it('keeps multi-dataset JSON Schemas valid MCP object input schemas', () => {
    const schemas = buildCanonicalSemanticQuerySchemas({
      orders: registry.orders,
      archivedOrders: registry.orders,
    }, { grainField: 'grain' });
    const reordered = buildCanonicalSemanticQuerySchemas({
      archivedOrders: registry.orders,
      orders: registry.orders,
    }, { grainField: 'grain' });

    expect(schemas.queryDatasetJsonSchema).toMatchObject({
      type: 'object',
      anyOf: expect.any(Array),
      allOf: expect.any(Array),
    });
    expect(schemas.queryMetricJsonSchema).toMatchObject({
      type: 'object',
      anyOf: expect.any(Array),
    });
    expect(reordered.manifestHash).toBe(schemas.manifestHash);
  });

  it('compiles the shared hosted fixture catalog into its runtime validator', () => {
    const fixture = JSON.parse(readFileSync(new URL(
      '../../../specs/deployment/fixtures/mcp-cloud-v1/expected-safe-catalog.json',
      import.meta.url,
    ), 'utf8')) as {
      datasets: Array<{
        name: string;
        timeDimension: string | null;
        dimensions: Array<{ name: string; type: 'boolean' | 'number' | 'string' | 'timestamp'; filterable: boolean; groupable: boolean }>;
        measures: Array<{ name: string }>;
        metrics: Array<{ name: string; dimensions: string[]; filters: string[]; grains: string[] }>;
        filters: Array<{ name: string; type: 'boolean' | 'number' | 'string' | 'timestamp'; operators: string[] }>;
        limits: DatasetCatalog['limits'];
      }>;
    };
    const source = fixture.datasets[0];
    const catalog: DatasetCatalog = {
      name: source.name,
      source: '[hosted-redacted]',
      timeKey: source.timeDimension ?? undefined,
      dimensions: Object.fromEntries(source.dimensions.map(entry => [entry.name, {
        type: entry.type,
        filterable: entry.filterable,
        groupable: entry.groupable,
      }])),
      measures: Object.fromEntries(source.measures.map(entry => [entry.name, {
        aggregation: 'count',
        field: '[hosted-redacted]',
        filterCount: 0,
      }])),
      metrics: Object.fromEntries(source.metrics.map(entry => [entry.name, {
        kind: 'base',
        dataset: source.name,
        valueType: 'number',
        dimensions: entry.dimensions,
        filters: entry.filters,
        grains: entry.grains,
      }])),
      filters: Object.fromEntries(source.filters.map(entry => [entry.name, {
        field: entry.name,
        operators: entry.operators as MetricFilter['operator'][],
        valueType: entry.type,
      }])),
      relationships: {},
      limits: source.limits,
      requiresTenant: true,
      supportedGrains: ['day', 'week', 'month', 'quarter', 'year'],
      orderableFields: [
        ...source.dimensions.map(entry => entry.name),
        ...source.measures.map(entry => entry.name),
        ...source.metrics.map(entry => entry.name),
        'period',
      ],
      maxLimit: source.limits?.maxResultSize,
    };
    const schemas = buildCanonicalSemanticQuerySchemas({ orders: catalog }, { grainField: 'grain' });

    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      measures: ['revenue'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
    }).success).toBe(true);
    expect(schemas.queryDataset.safeParse({
      dataset: 'orders',
      measures: ['revenue'],
      filters: [{ field: 'status', operator: 'like', value: '%' }],
    }).success).toBe(false);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
      dimensions: ['status'],
    }).success).toBe(true);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
      dimensions: ['orderId'],
    }).success).toBe(false);
  });

  it('restricts fixed-grain metrics to their declared grain', () => {
    const dailyRevenue = totalRevenue.by('day');
    const schemas = buildCanonicalSemanticQuerySchemas({
      orders: { ...Orders, metrics: { dailyRevenue } },
    }, { grainField: 'grain' });

    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'dailyRevenue',
      grain: 'day',
    }).success).toBe(true);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'dailyRevenue',
      grain: 'month',
    }).success).toBe(false);
  });

  it('honors metric-specific filters and grains from hosted catalogs', () => {
    const catalog = getDatasetCatalog(registry.orders);
    catalog.metrics.totalRevenue = {
      ...catalog.metrics.totalRevenue,
      dimensions: ['status'],
      filters: ['status'],
      grains: ['day'],
    };
    const schemas = buildCanonicalSemanticQuerySchemas({ orders: catalog }, { grainField: 'grain' });

    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
      grain: 'day',
    }).success).toBe(true);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
      filters: [{ field: 'createdAt', operator: 'eq', value: '2026-01-01' }],
    }).success).toBe(false);
    expect(schemas.queryMetric.safeParse({
      dataset: 'orders',
      metric: 'totalRevenue',
      grain: 'month',
    }).success).toBe(false);
  });
});
