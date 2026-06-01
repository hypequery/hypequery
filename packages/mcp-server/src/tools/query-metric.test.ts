/**
 * Unit tests for query-metric tool
 */

import { describe, it, expect, vi } from 'vitest';
import { queryMetricTool } from './query-metric.js';
import type { MetricExecutor } from '@hypequery/datasets';

describe('queryMetricTool', () => {
  const createMockExecutor = (mockResult: any): MetricExecutor => ({
    run: vi.fn().mockResolvedValue(mockResult),
    getBuilderFactory: vi.fn().mockReturnValue({}),
  } as any);

  it('should throw error when dataset parameter is missing', async () => {
    const executor = createMockExecutor({});

    await expect(
      queryMetricTool({}, executor, { metric: 'revenue' })
    ).rejects.toThrow('dataset parameter is required');
  });

  it('should throw error when metric parameter is missing', async () => {
    const executor = createMockExecutor({});

    await expect(
      queryMetricTool({}, executor, { dataset: 'orders' })
    ).rejects.toThrow('metric parameter is required');
  });

  it('should throw error when dataset is not found', async () => {
    const executor = createMockExecutor({});

    await expect(
      queryMetricTool({}, executor, { dataset: 'nonexistent', metric: 'revenue' })
    ).rejects.toThrow('Dataset not found: nonexistent');
  });

  it('should throw error when metric is not found', async () => {
    const datasets = {
      orders: {
        metrics: {
          count: {},
        },
      },
    };
    const executor = createMockExecutor({});

    await expect(
      queryMetricTool(datasets, executor, { dataset: 'orders', metric: 'nonexistent' })
    ).rejects.toThrow('Metric not found: nonexistent in dataset orders');
  });

  it('should execute simple metric query', async () => {
    const mockResult = {
      data: [{ revenue: 1000 }],
      meta: {
        sql: 'SELECT SUM(amount) as revenue FROM orders',
        timingMs: 45,
      },
    };

    const datasets = {
      orders: {
        revenue: { type: 'sum' },
      },
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
    });

    const data = JSON.parse(result.content[0].text);

    expect(data.data).toEqual([{ revenue: 1000 }]);
    expect(data.meta.sql).toBe('SELECT SUM(amount) as revenue FROM orders');
    expect(data.meta.timingMs).toBe(45);
    expect(data.meta.rowCount).toBe(1);

    expect(executor.run).toHaveBeenCalledWith(
      { type: 'sum' },
      {
        dimensions: [],
        filters: [],
        orderBy: [],
      },
      {
        runtime: {
          builderFactory: {},
          tenant: undefined,
        },
      }
    );
  });

  it('should execute metric query with dimensions', async () => {
    const mockResult = {
      data: [
        { region: 'US', revenue: 1000 },
        { region: 'EU', revenue: 800 },
      ],
      meta: {
        sql: 'SELECT region, SUM(amount) as revenue FROM orders GROUP BY region',
        timingMs: 60,
      },
    };

    const datasets = {
      orders: {
        metrics: {
          revenue: { type: 'sum' },
        },
      },
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
      dimensions: ['region'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toHaveLength(2);
    expect(data.meta.rowCount).toBe(2);

    expect(executor.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dimensions: ['region'],
      }),
      expect.anything()
    );
  });

  it('should execute metric query with filters', async () => {
    const mockResult = {
      data: [{ revenue: 500 }],
      meta: {},
    };

    const datasets = {
      orders: {
        revenue: { type: 'sum' },
      },
    };

    const executor = createMockExecutor(mockResult);
    const filters = [
      { field: 'status', operator: 'eq', value: 'completed' },
      { field: 'amount', operator: 'gt', value: 100 },
    ];

    await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
      filters,
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters,
      }),
      expect.anything()
    );
  });

  it('should execute metric query with time grain', async () => {
    const mockResult = {
      data: [
        { month: '2024-01', revenue: 1000 },
        { month: '2024-02', revenue: 1200 },
      ],
      meta: {},
    };

    const datasets = {
      orders: {
        revenue: { type: 'sum' },
      },
    };

    const executor = createMockExecutor(mockResult);
    await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
      grain: 'month',
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        by: 'month',
      }),
      expect.anything()
    );
  });

  it('should execute metric query with orderBy and limit', async () => {
    const mockResult = {
      data: [
        { region: 'US', revenue: 1000 },
        { region: 'EU', revenue: 800 },
      ],
      meta: {},
    };

    const datasets = {
      orders: {
        metrics: {
          revenue: { type: 'sum' },
        },
      },
    };

    const executor = createMockExecutor(mockResult);
    const orderBy = [{ field: 'revenue', direction: 'desc' }];

    await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
      dimensions: ['region'],
      orderBy,
      limit: 10,
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderBy,
        limit: 10,
      }),
      expect.anything()
    );
  });

  it('should find metric in metrics object', async () => {
    const mockResult = { data: [], meta: {} };

    const datasets = {
      orders: {
        metrics: {
          revenue: { type: 'sum' },
        },
      },
    };

    const executor = createMockExecutor(mockResult);
    await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
    });

    expect(executor.run).toHaveBeenCalledWith(
      { type: 'sum' },
      expect.anything(),
      expect.anything()
    );
  });

  it('should find metric as direct property', async () => {
    const mockResult = { data: [], meta: {} };

    const datasets = {
      orders: {
        totalRevenue: { type: 'sum' },
      },
    };

    const executor = createMockExecutor(mockResult);
    await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'totalRevenue',
    });

    expect(executor.run).toHaveBeenCalledWith(
      { type: 'sum' },
      expect.anything(),
      expect.anything()
    );
  });

  it('should handle empty result set', async () => {
    const mockResult = {
      data: [],
      meta: {
        sql: 'SELECT SUM(amount) as revenue FROM orders WHERE 1=0',
        timingMs: 10,
      },
    };

    const datasets = {
      orders: {
        revenue: { type: 'sum' },
      },
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryMetricTool(datasets, executor, {
      dataset: 'orders',
      metric: 'revenue',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toEqual([]);
    expect(data.meta.rowCount).toBe(0);
  });
});
