/**
 * Tests for SQL Tagged Template Literal
 */

import { describe, it, expect } from 'vitest';
import { sql, isSQLExpression, toSQLString } from './sql-tag';

describe('sql tagged template', () => {
  it('should create a SQLExpression from a template literal', () => {
    const expression = sql`DATE(created_at)`;

    expect(expression).toHaveProperty('__brand', 'SQLExpression');
    expect(expression).toHaveProperty('sql', 'DATE(created_at)');
    expect(expression).toHaveProperty('raw', true);
  });

  it('should handle template literals with interpolated strings', () => {
    const column = 'created_at';
    const expression = sql`DATE(${column})`;

    expect(expression.sql).toBe('DATE(created_at)');
  });

  it('should handle template literals with interpolated numbers', () => {
    const days = 7;
    const expression = sql`created_at >= NOW() - INTERVAL ${days} DAY`;

    expect(expression.sql).toBe('created_at >= NOW() - INTERVAL 7 DAY');
  });

  it('should handle nested SQL expressions', () => {
    const dateExpr = sql`DATE(created_at)`;
    const hourExpr = sql`toHour(${dateExpr})`;

    expect(hourExpr.sql).toBe('toHour(DATE(created_at))');
  });

  it('should handle null values', () => {
    const value = null;
    const expression = sql`COALESCE(amount, ${value})`;

    expect(expression.sql).toBe('COALESCE(amount, NULL)');
  });

  it('should handle undefined values', () => {
    const value = undefined;
    const expression = sql`COALESCE(amount, ${value})`;

    expect(expression.sql).toBe('COALESCE(amount, NULL)');
  });

  it('should handle complex expressions', () => {
    const expression = sql`
      CASE
        WHEN amount > 1000 THEN 'high'
        WHEN amount > 100 THEN 'medium'
        ELSE 'low'
      END
    `;

    expect(expression.sql).toContain('CASE');
    expect(expression.sql).toContain('WHEN amount > 1000');
  });
});

describe('isSQLExpression', () => {
  it('should return true for SQL expressions', () => {
    const expression = sql`DATE(created_at)`;
    expect(isSQLExpression(expression)).toBe(true);
  });

  it('should return false for strings', () => {
    expect(isSQLExpression('created_at')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isSQLExpression(123)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isSQLExpression(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isSQLExpression(undefined)).toBe(false);
  });

  it('should return false for objects without __brand', () => {
    expect(isSQLExpression({ sql: 'test' })).toBe(false);
  });

  it('should return false for objects with wrong __brand', () => {
    expect(isSQLExpression({ __brand: 'Other', sql: 'test' })).toBe(false);
  });
});

describe('toSQLString', () => {
  it('should return the sql property for SQL expressions', () => {
    const expression = sql`DATE(created_at)`;
    expect(toSQLString(expression)).toBe('DATE(created_at)');
  });

  it('should return the string as-is for plain strings', () => {
    expect(toSQLString('created_at')).toBe('created_at');
  });

  it('should throw for invalid values', () => {
    expect(() => toSQLString(123 as any)).toThrow();
    expect(() => toSQLString(null as any)).toThrow();
    expect(() => toSQLString(undefined as any)).toThrow();
  });
});
