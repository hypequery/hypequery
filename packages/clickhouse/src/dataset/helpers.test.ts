/**
 * Tests for Dimension and Metric Helpers
 */

import { describe, it, expect } from 'vitest';
import { dimension, metric } from './helpers';
import { sql } from './sql-tag';

describe('dimension helpers', () => {
  describe('dimension.string', () => {
    it('should create a string dimension from column name', () => {
      const dim = dimension.string('region', {
        description: 'Geographic region',
        examples: ['US', 'EU', 'APAC'],
      });

      expect(dim.sql).toBe('region');
      expect(dim.type).toBe('string');
      expect(dim.description).toBe('Geographic region');
      expect(dim.examples).toEqual(['US', 'EU', 'APAC']);
    });

    it('should create a string dimension from SQL expression', () => {
      const dim = dimension.string(sql`LOWER(status)`, {
        description: 'Order status in lowercase',
      });

      expect(dim.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(dim.type).toBe('string');
      expect(dim.description).toBe('Order status in lowercase');
    });

    it('should support join references', () => {
      const dim = dimension.string('customers.country', {
        description: 'Customer country',
        join: 'customers',
      });

      expect(dim.join).toBe('customers');
    });
  });

  describe('dimension.number', () => {
    it('should create a number dimension', () => {
      const dim = dimension.number('amount', {
        description: 'Order amount',
      });

      expect(dim.sql).toBe('amount');
      expect(dim.type).toBe('number');
      expect(dim.description).toBe('Order amount');
    });

    it('should create a number dimension from SQL expression', () => {
      const dim = dimension.number(sql`ROUND(amount, 2)`, {
        description: 'Rounded amount',
      });

      expect(dim.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(dim.type).toBe('number');
    });
  });

  describe('dimension.date', () => {
    it('should create a date dimension', () => {
      const dim = dimension.date(sql`DATE(created_at)`, {
        description: 'Order date',
      });

      expect(dim.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(dim.type).toBe('date');
      expect(dim.description).toBe('Order date');
    });

    it('should support examples', () => {
      const dim = dimension.date('order_date', {
        description: 'Order date',
        examples: ['2024-01-15', '2024-02-01'],
      });

      expect(dim.examples).toEqual(['2024-01-15', '2024-02-01']);
    });
  });

  describe('dimension.boolean', () => {
    it('should create a boolean dimension', () => {
      const dim = dimension.boolean('is_active', {
        description: 'Whether the order is active',
      });

      expect(dim.sql).toBe('is_active');
      expect(dim.type).toBe('boolean');
      expect(dim.description).toBe('Whether the order is active');
    });

    it('should create a boolean dimension from SQL expression', () => {
      const dim = dimension.boolean(sql`amount > 1000`, {
        description: 'High value order',
      });

      expect(dim.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(dim.type).toBe('boolean');
    });
  });
});

describe('metric helpers', () => {
  describe('metric.count', () => {
    it('should create a count metric', () => {
      const m = metric.count({
        description: 'Total number of orders',
      });

      expect(m.type).toBe('count');
      expect(m.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(m.description).toBe('Total number of orders');
    });

    it('should support format hints', () => {
      const m = metric.count({
        description: 'Total orders',
        format: 'number',
      });

      expect(m.format).toBe('number');
    });
  });

  describe('metric.sum', () => {
    it('should create a sum metric', () => {
      const m = metric.sum('amount', {
        description: 'Total revenue',
        format: 'currency',
      });

      expect(m.type).toBe('sum');
      expect(m.sql).toBe('amount');
      expect(m.description).toBe('Total revenue');
      expect(m.format).toBe('currency');
    });

    it('should create a sum metric from SQL expression', () => {
      const m = metric.sum(sql`total_amount - discount`, {
        description: 'Net revenue',
        format: 'currency',
      });

      expect(m.type).toBe('sum');
      expect(m.sql).toHaveProperty('__brand', 'SQLExpression');
    });
  });

  describe('metric.avg', () => {
    it('should create an avg metric', () => {
      const m = metric.avg('amount', {
        description: 'Average order value',
        format: 'currency',
      });

      expect(m.type).toBe('avg');
      expect(m.sql).toBe('amount');
      expect(m.description).toBe('Average order value');
      expect(m.format).toBe('currency');
    });
  });

  describe('metric.min', () => {
    it('should create a min metric', () => {
      const m = metric.min('amount', {
        description: 'Minimum order value',
        format: 'currency',
      });

      expect(m.type).toBe('min');
      expect(m.sql).toBe('amount');
    });
  });

  describe('metric.max', () => {
    it('should create a max metric', () => {
      const m = metric.max('amount', {
        description: 'Maximum order value',
        format: 'currency',
      });

      expect(m.type).toBe('max');
      expect(m.sql).toBe('amount');
    });
  });

  describe('metric.countDistinct', () => {
    it('should create a count distinct metric', () => {
      const m = metric.countDistinct('customer_id', {
        description: 'Unique customers',
      });

      expect(m.type).toBe('countDistinct');
      expect(m.sql).toBe('customer_id');
    });
  });

  describe('metric.custom', () => {
    it('should create a custom metric', () => {
      const m = metric.custom(
        sql`sum(total_amount) / count(DISTINCT customer_id)`,
        {
          description: 'Revenue per customer',
          format: 'currency',
        }
      );

      expect(m.type).toBe('custom');
      expect(m.sql).toHaveProperty('__brand', 'SQLExpression');
      expect(m.description).toBe('Revenue per customer');
    });
  });

  describe('join support', () => {
    it('should support join references in metrics', () => {
      const m = metric.sum('orders.amount', {
        description: 'Total revenue from orders',
        join: 'orders',
        format: 'currency',
      });

      expect(m.join).toBe('orders');
    });
  });

  describe('fan-out protection', () => {
    it('should support allowFanout flag', () => {
      const m = metric.sum('orders.amount', {
        description: 'Total revenue (with fan-out)',
        join: 'orders',
        allowFanout: true,
      });

      expect(m.allowFanout).toBe(true);
    });

    it('should default allowFanout to undefined', () => {
      const m = metric.sum('amount', {
        description: 'Total revenue',
      });

      expect(m.allowFanout).toBeUndefined();
    });
  });
});
