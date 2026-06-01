/**
 * Unit tests for dataset-guide prompt
 */

import { describe, it, expect } from 'vitest';
import { datasetGuidePrompt } from './dataset-guide.js';

describe('datasetGuidePrompt', () => {
  it('should throw error when specific dataset not found', () => {
    expect(() => datasetGuidePrompt({}, 'nonexistent')).toThrow(
      'Dataset not found: nonexistent'
    );
  });

  it('should generate general guide when no dataset specified', () => {
    const datasets = {
      orders: {},
      customers: {},
      products: {},
    };

    const result = datasetGuidePrompt(datasets);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.type).toBe('text');

    const text = result.messages[0].content.text;
    expect(text).toContain('# Hypequery Semantic Layer Guide');
    expect(text).toContain('## Available Datasets');
    expect(text).toContain('- orders');
    expect(text).toContain('- customers');
    expect(text).toContain('- products');
    expect(text).toContain('## How to Query');
    expect(text).toContain('list_datasets');
    expect(text).toContain('get_dataset_schema');
    expect(text).toContain('query_metric');
    expect(text).toContain('query_dataset');
    expect(text).toContain('## Filter Operators');
    expect(text).toContain('## Time Grains');
  });

  it('should generate dataset-specific guide', () => {
    const datasets = {
      orders: {
        dimensions: {
          customerId: {},
          region: {},
          status: {},
        },
        metrics: {
          revenue: {},
          count: {},
          avgOrderValue: {},
        },
      },
    };

    const result = datasetGuidePrompt(datasets, 'orders');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');

    const text = result.messages[0].content.text;
    expect(text).toContain('# Querying the orders dataset');
    expect(text).toContain('## Available Dimensions');
    expect(text).toContain('- customerId');
    expect(text).toContain('- region');
    expect(text).toContain('- status');
    expect(text).toContain('## Available Metrics');
    expect(text).toContain('- revenue');
    expect(text).toContain('- count');
    expect(text).toContain('- avgOrderValue');
    expect(text).toContain('## Example Queries');
    expect(text).toContain('## Tips');
  });

  it('should handle dataset with no dimensions or metrics', () => {
    const datasets = {
      empty: {},
    };

    const result = datasetGuidePrompt(datasets, 'empty');
    const text = result.messages[0].content.text;

    expect(text).toContain('# Querying the empty dataset');
    expect(text).toContain('## Available Dimensions');
    expect(text).toContain('## Available Metrics');
  });

  it('should handle dataset with only dimensions', () => {
    const datasets = {
      customers: {
        dimensions: {
          id: {},
          name: {},
          email: {},
        },
      },
    };

    const result = datasetGuidePrompt(datasets, 'customers');
    const text = result.messages[0].content.text;

    expect(text).toContain('- id');
    expect(text).toContain('- name');
    expect(text).toContain('- email');
    expect(text).toContain('## Available Metrics');
  });

  it('should handle dataset with only metrics', () => {
    const datasets = {
      analytics: {
        metrics: {
          totalUsers: {},
          activeUsers: {},
          churnRate: {},
        },
      },
    };

    const result = datasetGuidePrompt(datasets, 'analytics');
    const text = result.messages[0].content.text;

    expect(text).toContain('## Available Dimensions');
    expect(text).toContain('## Available Metrics');
    expect(text).toContain('- totalUsers');
    expect(text).toContain('- activeUsers');
    expect(text).toContain('- churnRate');
  });

  it('should include example queries using actual dimension and metric names', () => {
    const datasets = {
      sales: {
        dimensions: {
          territory: {},
          product: {},
        },
        metrics: {
          totalSales: {},
          unitsSold: {},
        },
      },
    };

    const result = datasetGuidePrompt(datasets, 'sales');
    const text = result.messages[0].content.text;

    expect(text).toContain('### Simple metric query');
    expect(text).toContain('"totalSales"');
    expect(text).toContain('### Grouped by dimension');
    expect(text).toContain('"territory"');
    expect(text).toContain('### With filters');
    expect(text).toContain('where product =');
  });

  it('should use fallback names when dimensions or metrics are empty', () => {
    const datasets = {
      minimal: {
        dimensions: {},
        metrics: {},
      },
    };

    const result = datasetGuidePrompt(datasets, 'minimal');
    const text = result.messages[0].content.text;

    // Should use fallback examples like 'revenue', 'region', 'status'
    expect(text).toContain('revenue');
    expect(text).toContain('region');
  });

  it('should list all available datasets in general guide', () => {
    const datasets = {
      orders: {},
      customers: {},
      products: {},
      shipments: {},
      returns: {},
    };

    const result = datasetGuidePrompt(datasets);
    const text = result.messages[0].content.text;

    expect(text).toContain('- orders');
    expect(text).toContain('- customers');
    expect(text).toContain('- products');
    expect(text).toContain('- shipments');
    expect(text).toContain('- returns');
  });

  it('should include all filter operators in general guide', () => {
    const datasets = { test: {} };

    const result = datasetGuidePrompt(datasets);
    const text = result.messages[0].content.text;

    expect(text).toContain('`eq`: Equal to');
    expect(text).toContain('`neq`: Not equal to');
    expect(text).toContain('`gt`: Greater than');
    expect(text).toContain('`gte`: Greater than or equal to');
    expect(text).toContain('`lt`: Less than');
    expect(text).toContain('`lte`: Less than or equal to');
    expect(text).toContain('`in`: In list');
    expect(text).toContain('`notIn`: Not in list');
    expect(text).toContain('`between`: Between two values');
    expect(text).toContain('`like`: Pattern match');
  });

  it('should include all time grains in general guide', () => {
    const datasets = { test: {} };

    const result = datasetGuidePrompt(datasets);
    const text = result.messages[0].content.text;

    expect(text).toContain('`day`: Daily aggregation');
    expect(text).toContain('`week`: Weekly aggregation');
    expect(text).toContain('`month`: Monthly aggregation');
    expect(text).toContain('`quarter`: Quarterly aggregation');
    expect(text).toContain('`year`: Yearly aggregation');
  });

  it('should include example workflow in general guide', () => {
    const datasets = { orders: {} };

    const result = datasetGuidePrompt(datasets);
    const text = result.messages[0].content.text;

    expect(text).toContain('## Example Workflow');
    expect(text).toContain('list_datasets()');
    expect(text).toContain('get_dataset_schema({ dataset: "orders" })');
    expect(text).toContain('query_metric');
  });

  it('should format prompt message structure correctly', () => {
    const datasets = { test: {} };

    const result = datasetGuidePrompt(datasets);

    expect(result).toHaveProperty('messages');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages[0]).toMatchObject({
      role: 'user',
      content: {
        type: 'text',
        text: expect.any(String),
      },
    });
  });
});
