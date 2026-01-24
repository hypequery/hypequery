/**
 * Tests for Dataset Definition Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateDatasetDefinition,
  validateDatasets,
  normalizeDimension,
  normalizeDimensions,
  inferDimensionType,
  getDimensionSQL,
  getMetricSQL,
  getDataset,
  listDatasets,
  hasDataset,
  getDimensionNames,
  getMetricNames,
  hasDimension,
  hasMetric,
  getDimension,
  getMetric,
} from './definition';
import { sql } from './sql-tag';
import { dimension, metric } from './helpers';
import type { DatasetDefinition, DatasetsMap } from './types';

// Test dataset for use in multiple tests
const testDataset: DatasetDefinition = {
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
  },
};

const testDatasets: DatasetsMap = {
  orders: testDataset,
  customers: {
    name: 'customers',
    description: 'Customer data',
    table: 'customers',
    dimensions: {
      id: dimension.string('id', { description: 'Customer ID' }),
      country: dimension.string('country', { description: 'Country' }),
    },
    metrics: {
      totalCustomers: metric.count({ description: 'Total customers' }),
    },
  },
};

describe('validateDatasetDefinition', () => {
  it('should validate a valid dataset', () => {
    expect(() => validateDatasetDefinition('orders', testDataset)).not.toThrow();
  });

  it('should throw if name is missing', () => {
    const invalid = { ...testDataset, name: '' };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/name/);
  });

  it('should throw if table is missing', () => {
    const invalid = { ...testDataset, table: '' };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/table/);
  });

  it('should throw if dimensions are empty', () => {
    const invalid = { ...testDataset, dimensions: {} };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/dimension/);
  });

  it('should throw if metrics are empty', () => {
    const invalid = { ...testDataset, metrics: {} };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/metric/);
  });

  it('should validate tenant config', () => {
    const withTenant = {
      ...testDataset,
      tenant: { column: 'merchant_id', required: true },
    };
    expect(() => validateDatasetDefinition('orders', withTenant)).not.toThrow();
  });

  it('should throw if tenant config is invalid', () => {
    const invalid = {
      ...testDataset,
      tenant: { column: '', required: true },
    };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/tenant/);
  });

  it('should validate limits', () => {
    const withLimits = {
      ...testDataset,
      limits: {
        maxDimensions: 10,
        maxMetrics: 20,
        maxFilters: 50,
        maxResultSize: 1000,
      },
    };
    expect(() => validateDatasetDefinition('orders', withLimits)).not.toThrow();
  });

  it('should throw if limits are invalid', () => {
    const invalid = {
      ...testDataset,
      limits: { maxDimensions: 0 },
    };
    expect(() => validateDatasetDefinition('orders', invalid)).toThrow(/maxDimensions/);
  });
});

describe('validateDatasets', () => {
  it('should validate a valid datasets map', () => {
    expect(() => validateDatasets(testDatasets)).not.toThrow();
  });

  it('should throw if datasets map is empty', () => {
    expect(() => validateDatasets({})).toThrow(/No datasets/);
  });

  it('should throw if any dataset is invalid', () => {
    const invalid = {
      orders: testDataset,
      invalid: { ...testDataset, name: '', table: 'test' },
    };
    expect(() => validateDatasets(invalid)).toThrow();
  });
});

describe('normalizeDimension', () => {
  it('should normalize a simple string dimension', () => {
    const normalized = normalizeDimension('region');
    expect(normalized.sql).toBe('region');
    expect(normalized.type).toBe('string');
    expect(normalized.description).toBe('');
  });

  it('should normalize a SQL expression dimension', () => {
    const expr = sql`DATE(created_at)`;
    const normalized = normalizeDimension(expr);
    expect(normalized.sql).toEqual(expr);
    expect(normalized.type).toBe('string');
  });

  it('should pass through a full dimension definition', () => {
    const dim = dimension.string('region', {
      description: 'Geographic region',
      examples: ['US', 'EU'],
    });
    const normalized = normalizeDimension(dim);
    expect(normalized).toEqual(dim);
  });
});

describe('normalizeDimensions', () => {
  it('should normalize all dimensions in a map', () => {
    const dimensions = {
      region: 'region',
      date: sql`DATE(created_at)`,
      status: dimension.string('status', { description: 'Order status' }),
    };

    const normalized = normalizeDimensions(dimensions);

    expect(normalized.region.sql).toBe('region');
    expect(normalized.region.type).toBe('string');
    expect(normalized.date.sql).toHaveProperty('__brand', 'SQLExpression');
    expect(normalized.status.description).toBe('Order status');
  });
});

describe('inferDimensionType', () => {
  it('should infer string for simple column', () => {
    expect(inferDimensionType('region')).toBe('string');
  });

  it('should infer string for SQL expression', () => {
    expect(inferDimensionType(sql`DATE(created_at)`)).toBe('string');
  });

  it('should use explicit type from definition', () => {
    const dim = dimension.date(sql`DATE(created_at)`, {
      description: 'Order date',
    });
    expect(inferDimensionType(dim)).toBe('date');
  });
});

describe('getDimensionSQL', () => {
  it('should get SQL from simple column', () => {
    expect(getDimensionSQL('region')).toBe('region');
  });

  it('should get SQL from SQL expression', () => {
    const expr = sql`DATE(created_at)`;
    expect(getDimensionSQL(expr)).toBe('DATE(created_at)');
  });

  it('should get SQL from dimension definition', () => {
    const dim = dimension.date(sql`DATE(created_at)`, {
      description: 'Order date',
    });
    expect(getDimensionSQL(dim)).toBe('DATE(created_at)');
  });
});

describe('getMetricSQL', () => {
  it('should get SQL from metric definition', () => {
    const m = metric.sum('amount', {
      description: 'Total revenue',
    });
    expect(getMetricSQL(m)).toBe('amount');
  });

  it('should get SQL from SQL expression metric', () => {
    const m = metric.custom(sql`sum(amount) / count(DISTINCT customer_id)`, {
      description: 'Revenue per customer',
    });
    expect(getMetricSQL(m)).toBe('sum(amount) / count(DISTINCT customer_id)');
  });
});

describe('getDataset', () => {
  it('should get a dataset by name', () => {
    const dataset = getDataset(testDatasets, 'orders');
    expect(dataset.name).toBe('orders');
    expect(dataset.table).toBe('orders');
  });

  it('should throw if dataset not found', () => {
    expect(() => getDataset(testDatasets, 'unknown')).toThrow(/not found/);
  });

  it('should include available datasets in error message', () => {
    try {
      getDataset(testDatasets, 'unknown');
    } catch (error: any) {
      expect(error.message).toContain('orders');
      expect(error.message).toContain('customers');
    }
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

describe('hasDataset', () => {
  it('should return true for existing dataset', () => {
    expect(hasDataset(testDatasets, 'orders')).toBe(true);
  });

  it('should return false for non-existing dataset', () => {
    expect(hasDataset(testDatasets, 'unknown')).toBe(false);
  });
});

describe('getDimensionNames', () => {
  it('should get all dimension names', () => {
    const names = getDimensionNames(testDataset);
    expect(names).toContain('region');
    expect(names).toContain('date');
    expect(names).toContain('amount');
    expect(names.length).toBe(3);
  });
});

describe('getMetricNames', () => {
  it('should get all metric names', () => {
    const names = getMetricNames(testDataset);
    expect(names).toContain('revenue');
    expect(names).toContain('orderCount');
    expect(names.length).toBe(2);
  });
});

describe('hasDimension', () => {
  it('should return true for existing dimension', () => {
    expect(hasDimension(testDataset, 'region')).toBe(true);
  });

  it('should return false for non-existing dimension', () => {
    expect(hasDimension(testDataset, 'unknown')).toBe(false);
  });
});

describe('hasMetric', () => {
  it('should return true for existing metric', () => {
    expect(hasMetric(testDataset, 'revenue')).toBe(true);
  });

  it('should return false for non-existing metric', () => {
    expect(hasMetric(testDataset, 'unknown')).toBe(false);
  });
});

describe('getDimension', () => {
  it('should get a dimension by name', () => {
    const dim = getDimension(testDataset, 'region');
    expect(dim.type).toBe('string');
    expect(dim.description).toBe('Geographic region');
  });

  it('should throw if dimension not found', () => {
    expect(() => getDimension(testDataset, 'unknown')).toThrow(/not found/);
  });

  it('should include available dimensions in error message', () => {
    try {
      getDimension(testDataset, 'unknown');
    } catch (error: any) {
      expect(error.message).toContain('region');
      expect(error.message).toContain('date');
      expect(error.message).toContain('amount');
    }
  });
});

describe('getMetric', () => {
  it('should get a metric by name', () => {
    const m = getMetric(testDataset, 'revenue');
    expect(m.type).toBe('sum');
    expect(m.description).toBe('Total revenue');
  });

  it('should throw if metric not found', () => {
    expect(() => getMetric(testDataset, 'unknown')).toThrow(/not found/);
  });

  it('should include available metrics in error message', () => {
    try {
      getMetric(testDataset, 'unknown');
    } catch (error: any) {
      expect(error.message).toContain('revenue');
      expect(error.message).toContain('orderCount');
    }
  });
});
