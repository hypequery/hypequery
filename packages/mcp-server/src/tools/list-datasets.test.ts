/**
 * Unit tests for list-datasets tool
 */

import { describe, it, expect } from 'vitest';
import { listDatasetsTool } from './list-datasets.js';

describe('listDatasetsTool', () => {
  it('should return empty list for no datasets', async () => {
    const result = await listDatasetsTool({});

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const data = JSON.parse(result.content[0].text);
    expect(data.datasets).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should list datasets with descriptions', async () => {
    const datasets = {
      orders: {
        description: 'Order data',
        dimensions: { customerId: {}, region: {} },
        metrics: { revenue: {}, count: {} },
      },
      customers: {
        description: 'Customer data',
        dimensions: { id: {} },
        metrics: { totalOrders: {} },
      },
    };

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.total).toBe(2);
    expect(data.datasets).toHaveLength(2);

    const ordersDataset = data.datasets.find((d: any) => d.name === 'orders');
    expect(ordersDataset).toMatchObject({
      name: 'orders',
      description: 'Order data',
      dimensionCount: 2,
      measureCount: 0,
      metricCount: 2,
    });

    const customersDataset = data.datasets.find((d: any) => d.name === 'customers');
    expect(customersDataset).toMatchObject({
      name: 'customers',
      description: 'Customer data',
      dimensionCount: 1,
      measureCount: 0,
      metricCount: 1,
    });
  });

  it('should count measures separately from named metrics', async () => {
    const datasets = {
      orders: {
        description: 'Order data',
        dimensions: { region: {} },
        measures: { revenue: {}, orderCount: {} },
        metrics: { totalRevenue: {} },
      },
    };

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.datasets[0]).toMatchObject({
      name: 'orders',
      dimensionCount: 1,
      measureCount: 2,
      metricCount: 1,
    });
  });

  it('should handle datasets with config descriptions', async () => {
    const datasets = {
      events: {
        config: {
          description: 'Event tracking data',
        },
        dimensions: {},
        metrics: {},
      },
    };

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.datasets[0].description).toBe('Event tracking data');
  });

  it('should provide default description when missing', async () => {
    const datasets = {
      unknown: {
        dimensions: {},
        metrics: {},
      },
    };

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.datasets[0].description).toBe('No description available');
  });

  it('should handle datasets without dimensions or metrics', async () => {
    const datasets = {
      minimal: {
        description: 'Minimal dataset',
      },
    };

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.datasets[0]).toMatchObject({
      name: 'minimal',
      description: 'Minimal dataset',
      dimensionCount: 0,
      measureCount: 0,
      metricCount: 0,
    });
  });

  it('should handle large number of datasets', async () => {
    const datasets: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      datasets[`dataset${i}`] = {
        description: `Dataset ${i}`,
        dimensions: { dim1: {}, dim2: {} },
        metrics: { metric1: {} },
      };
    }

    const result = await listDatasetsTool(datasets);
    const data = JSON.parse(result.content[0].text);

    expect(data.total).toBe(100);
    expect(data.datasets).toHaveLength(100);
  });
});
