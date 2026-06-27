import { describe, expect, it, vi } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import {
  generateDatasetTools,
  toAISDKTools,
  toMcpTools,
  toOpenAITools,
} from './tools.js';

describe('semantic dataset tools', () => {
  const Orders = dataset('orders', {
    source: 'orders',
    tenantKey: 'tenant_id',
    timeKey: 'created_at',
    dimensions: {
      status: dimension.string({ label: 'Status' }),
      createdAt: dimension.timestamp({ column: 'created_at' }),
      amount: dimension.number(),
    },
    measures: {
      revenue: measure.sum('amount'),
      orderCount: measure.count('status'),
    },
    filters: {
      status: {
        __type: 'filter_definition',
        field: 'status',
        operators: ['eq', 'in'],
      },
    },
    limits: {
      maxResultSize: 500,
    },
  });

  const totalRevenue = Orders.metric('totalRevenue', {
    measure: 'revenue',
    label: 'Total Revenue',
  });

  it('generates a catalog-mode query tool from dataset catalogs', async () => {
    const execute = vi.fn(async () => ({
      data: [{ status: 'paid', revenue: 42 }],
      meta: { sql: 'SELECT secret', rowCount: 1 },
    }));
    const [tool] = generateDatasetTools({
      datasets: {
        orders: {
          ...Orders,
          metrics: { totalRevenue },
        },
      },
      analytics: { execute },
    });

    expect(tool.name).toBe('query_dataset');
    expect(tool.parameters.properties?.dataset.enum).toEqual(['orders']);
    expect(tool.parameters.properties?.dimensions.items?.enum).toEqual([
      'status',
      'createdAt',
      'amount',
    ]);
    expect(tool.parameters.properties?.measures.items?.enum).toEqual([
      'revenue',
      'orderCount',
    ]);
    expect(tool.parameters.properties?.limit.maximum).toBe(500);

    const result = await tool.execute({
      dataset: 'orders',
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
      by: 'day',
      limit: 50,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'orders' }),
      {
        dimensions: ['status'],
        measures: ['revenue'],
        filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
        by: 'day',
        limit: 50,
      },
      undefined,
    );
    expect(result).toEqual({
      data: [{ status: 'paid', revenue: 42 }],
      meta: { rowCount: 1 },
    });
  });

  it('fails with repairable errors before execution for invalid tool input', async () => {
    const execute = vi.fn();
    const [tool] = generateDatasetTools({
      datasets: { orders: Orders },
      analytics: { execute },
    });

    await expect(
      tool.execute({
        dataset: 'orders',
        dimensions: ['missing'],
      }),
    ).rejects.toThrow('Invalid dimensions: missing. Available: status, createdAt, amount.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('generates per-dataset and per-metric tool shapes', () => {
    const analytics = { execute: vi.fn() };
    const datasetTools = generateDatasetTools({
      datasets: { orders: Orders },
      analytics,
      mode: 'per-dataset',
    });
    const metricTools = generateDatasetTools({
      datasets: {
        orders: {
          ...Orders,
          metrics: { totalRevenue },
        },
      },
      analytics,
      mode: 'per-metric',
    });

    expect(datasetTools.map(tool => tool.name)).toEqual(['query_orders']);
    expect(datasetTools[0].parameters.required).toEqual([]);
    expect(metricTools.map(tool => tool.name)).toEqual(['query_totalRevenue']);
    expect(metricTools[0].parameters.properties?.measures).toBeUndefined();
  });

  it('rejects invalid per-metric order fields before execution', async () => {
    const execute = vi.fn();
    const [tool] = generateDatasetTools({
      datasets: {
        orders: {
          ...Orders,
          metrics: { totalRevenue },
        },
      },
      analytics: { execute },
      mode: 'per-metric',
    });

    await expect(
      tool.execute({
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      }),
    ).rejects.toThrow('Invalid orderBy fields: revenue. Available: status, createdAt, amount, totalRevenue, period.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('adapts generated tool metadata for OpenAI, AI SDK, and MCP runtimes', () => {
    const tools = generateDatasetTools({
      datasets: { orders: Orders },
      analytics: { execute: vi.fn() },
    });

    expect(toOpenAITools(tools)[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'query_dataset',
      },
    });
    expect(Object.keys(toAISDKTools(tools))).toEqual(['query_dataset']);
    expect(toMcpTools(tools)[0]).toMatchObject({
      name: 'query_dataset',
      inputSchema: tools[0].parameters,
    });
  });
});
