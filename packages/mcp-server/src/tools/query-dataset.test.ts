/**
 * Unit tests for query-dataset tool
 */

import { describe, it, expect, vi } from 'vitest';
import { queryDatasetTool } from './query-dataset.js';
import type { SemanticExecutor } from '@hypequery/datasets';

describe('queryDatasetTool', () => {
  const createMockExecutor = (mockResult: any): SemanticExecutor => ({
    metric: vi.fn(),
    dataset: vi.fn().mockResolvedValue(mockResult),
    run: vi.fn(),
    getBuilderFactory: vi.fn().mockReturnValue({}),
  } as any);

  it('should throw error when dataset parameter is missing', async () => {
    const executor = createMockExecutor({});

    await expect(
      queryDatasetTool({}, executor, { dimensions: ['region'] })
    ).rejects.toThrow('dataset parameter is required');
  });

  it('should throw error when dataset is not found', async () => {
    const executor = createMockExecutor({});

    await expect(
      queryDatasetTool({}, executor, { dataset: 'nonexistent', dimensions: ['region'] })
    ).rejects.toThrow('Dataset not found: nonexistent');
  });

  it('should throw error when no dimensions or metrics specified', async () => {
    const datasets = {
      orders: {},
    };
    const executor = createMockExecutor({});

    await expect(
      queryDatasetTool(datasets, executor, { dataset: 'orders' })
    ).rejects.toThrow('At least one dimension or metric must be specified');
  });

  it('should execute query with dimensions only', async () => {
    const mockResult = {
      data: [
        { region: 'US' },
        { region: 'EU' },
      ],
      meta: {
        sql: 'SELECT DISTINCT region FROM orders',
        timingMs: 30,
      },
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toHaveLength(2);
    expect(data.meta.rowCount).toBe(2);

    expect(executor.dataset).toHaveBeenCalledWith(
      {},
      {
        dimensions: ['region'],
        measures: [],
        filters: [],
        orderBy: [],
      },
      {
        runtime: {
          tenant: undefined,
        },
      }
    );
  });

  it('should execute query with metrics only', async () => {
    const mockResult = {
      data: [{ revenue: 1000, count: 50 }],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      metrics: ['revenue', 'count'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toEqual([{ revenue: 1000, count: 50 }]);

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        measures: ['revenue', 'count'],
        dimensions: [],
      }),
      expect.anything()
    );
  });

  it('should execute query with dimensions and metrics', async () => {
    const mockResult = {
      data: [
        { region: 'US', revenue: 1000 },
        { region: 'EU', revenue: 800 },
      ],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
      metrics: ['revenue'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toHaveLength(2);

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dimensions: ['region'],
        measures: ['revenue'],
      }),
      expect.anything()
    );
  });

  it('should execute query with filters', async () => {
    const mockResult = {
      data: [{ region: 'US', revenue: 500 }],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const filters = [
      { field: 'status', operator: 'eq', value: 'completed' },
      { field: 'amount', operator: 'gte', value: 100 },
    ];

    await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
      metrics: ['revenue'],
      filters,
    });

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters,
      }),
      expect.anything()
    );
  });

  it('should execute query with time grain', async () => {
    const mockResult = {
      data: [
        { week: '2024-W01', revenue: 1000 },
        { week: '2024-W02', revenue: 1200 },
      ],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['week'],
      metrics: ['revenue'],
      grain: 'week',
    });

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        by: 'week',
      }),
      expect.anything()
    );
  });

  it('should execute query with orderBy and limit', async () => {
    const mockResult = {
      data: [
        { region: 'US', revenue: 1000 },
        { region: 'EU', revenue: 800 },
        { region: 'APAC', revenue: 600 },
      ],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const orderBy = [
      { field: 'revenue', direction: 'desc' },
      { field: 'region', direction: 'asc' },
    ];

    await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
      metrics: ['revenue'],
      orderBy,
      limit: 5,
    });

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderBy,
        limit: 5,
      }),
      expect.anything()
    );
  });

  it('should handle complex multi-dimensional query', async () => {
    const mockResult = {
      data: [
        { region: 'US', category: 'Electronics', revenue: 500, count: 10 },
        { region: 'US', category: 'Clothing', revenue: 300, count: 15 },
        { region: 'EU', category: 'Electronics', revenue: 400, count: 8 },
      ],
      meta: {
        sql: 'SELECT region, category, SUM(amount) as revenue, COUNT(*) as count FROM orders GROUP BY region, category',
        timingMs: 75,
      },
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region', 'category'],
      metrics: ['revenue', 'count'],
      filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 10,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toHaveLength(3);
    expect(data.meta.rowCount).toBe(3);
    expect(data.meta.timingMs).toBe(75);
  });

  it('should handle empty result set', async () => {
    const mockResult = {
      data: [],
      meta: {
        sql: 'SELECT region FROM orders WHERE 1=0',
        timingMs: 5,
      },
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    const result = await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toEqual([]);
    expect(data.meta.rowCount).toBe(0);
  });

  it('should handle empty arrays for optional parameters', async () => {
    const mockResult = {
      data: [{ region: 'US' }],
      meta: {},
    };

    const datasets = {
      orders: {},
    };

    const executor = createMockExecutor(mockResult);
    await queryDatasetTool(datasets, executor, {
      dataset: 'orders',
      dimensions: ['region'],
      filters: [],
      orderBy: [],
    });

    expect(executor.dataset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: [],
        orderBy: [],
      }),
      expect.anything()
    );
  });
});
