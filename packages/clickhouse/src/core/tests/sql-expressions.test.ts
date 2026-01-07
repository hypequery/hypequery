import type { Equal, Expect } from '@type-challenges/utils';
import { raw, rawAs, selectExpr, toDateTime, formatDateTime, toStartOfInterval, datePart } from '../utils/sql-expressions.js';
import { setupTestBuilder } from './test-utils.js';

describe('SQL Expressions', () => {
  describe('Utility Functions', () => {
    it('should create raw SQL expressions', () => {
      const expr = raw('COUNT(*)');
      expect(expr.__type).toBe('expression');
      expect(expr.toSql()).toBe('COUNT(*)');
    });

    it('should create aliased SQL expressions', () => {
      const expr = rawAs('COUNT(*)', 'total');
      expect(expr.__type).toBe('aliased_expression');
      expect(expr.alias).toBe('total');
      expect(expr.toSql()).toBe('COUNT(*) AS total');
    });

    it('should provide helper for toDateTime function', () => {
      const expr = toDateTime('created_at');
      expect(expr.toSql()).toBe('toDateTime(created_at)');

      const aliasedExpr = toDateTime('created_at', 'date');
      expect(aliasedExpr.toSql()).toBe('toDateTime(created_at) AS date');
    });

    it('should provide helper for formatDateTime function', () => {
      const expr = formatDateTime('created_at', 'Y-m-d');
      expect(expr.toSql()).toBe('formatDateTime(created_at, \'Y-m-d\')');

      const aliasedExpr = formatDateTime('created_at', 'Y-m-d', { alias: 'formatted_date' });
      expect(aliasedExpr.toSql()).toBe('formatDateTime(created_at, \'Y-m-d\') AS formatted_date');

      // Test with timezone parameter
      const exprWithTz = formatDateTime('created_at', 'Y-m-d', { timezone: 'UTC' });
      expect(exprWithTz.toSql()).toBe('formatDateTime(created_at, \'Y-m-d\', \'UTC\')');

      const aliasedExprWithTz = formatDateTime('created_at', 'Y-m-d', { timezone: 'UTC', alias: 'formatted_date' });
      expect(aliasedExprWithTz.toSql()).toBe('formatDateTime(created_at, \'Y-m-d\', \'UTC\') AS formatted_date');
    });

    it('should provide helper for toStartOfInterval function', () => {
      const expr = toStartOfInterval('created_at', '1 day');
      expect(expr.toSql()).toBe('toStartOfInterval(created_at, INTERVAL 1 day)');

      const aliasedExpr = toStartOfInterval('created_at', '1 day', 'day_start');
      expect(aliasedExpr.toSql()).toBe('toStartOfInterval(created_at, INTERVAL 1 day) AS day_start');
    });

    it('should provide helper for datePart function', () => {
      const expr = datePart('year', 'created_at');
      expect(expr.toSql()).toBe('toYear(created_at)');

      const aliasedExpr = datePart('month', 'created_at', 'month_num');
      expect(aliasedExpr.toSql()).toBe('toMonth(created_at) AS month_num');
    });
  });

  describe('Integration with QueryBuilder', () => {
    let builder = setupTestBuilder();

    beforeEach(() => {
      builder = setupTestBuilder();
    });

    it('should handle raw expressions in select clause', () => {
      const sql = builder
        .select(['id', raw('COUNT(*)')])
        .toSQL();

      expect(sql).toBe('SELECT id, COUNT(*) FROM test_table');
    });

    it('should handle aliased expressions in select clause', () => {
      const sql = builder
        .select(['id', rawAs('COUNT(*)', 'total')])
        .toSQL();

      expect(sql).toBe('SELECT id, COUNT(*) AS total FROM test_table');
    });

    it('should support selectExpr helper with alias inference', () => {
      const query = builder
        .select([
          selectExpr('toStartOfWeek(created_at)', 'week'),
          'id'
        ])
        .groupBy('week');

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = { week: unknown; id: number }[];
      type _Assert = Expect<Equal<Result, Expected>>;

      expect(query.toSQL()).toBe('SELECT toStartOfWeek(created_at) AS week, id FROM test_table GROUP BY week');
    });

    it('should handle ClickHouse functions with aliases', () => {
      const sql = builder
        .select([
          'id',
          toDateTime('created_at', 'date_time'),
          formatDateTime('created_at', 'Y-m-d', { alias: 'formatted_date' })
        ])
        .toSQL();

      expect(sql).toBe('SELECT id, toDateTime(created_at) AS date_time, formatDateTime(created_at, \'Y-m-d\') AS formatted_date FROM test_table');
    });

    it('should handle ClickHouse interval functions', () => {
      const query = builder
        .select([
          toStartOfInterval('created_at', '1 day', 'day'),
          datePart('month', 'created_at', 'month')
        ])
        .groupBy(['day', 'month']);

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = { day: Date; month: number }[];
      type _Assert = Expect<Equal<Result, Expected>>;

      expect(query.toSQL()).toBe('SELECT toStartOfInterval(created_at, INTERVAL 1 day) AS day, toMonth(created_at) AS month FROM test_table GROUP BY day, month');
    });

    it('should handle complex expressions with joins', () => {
      // Add some type casting to deal with TypeScript's type checking
      const sql = builder
        .select([
          'test_table.id',
          rawAs('COUNT(DISTINCT test_table.name)', 'unique_names'),
          formatDateTime('test_table.created_at', 'Y-m-d', { timezone: 'Europe/Amsterdam', alias: 'date' })
        ])
        .groupBy(['test_table.id', 'created_at'])
        .toSQL();

      expect(sql).toBe('SELECT test_table.id, COUNT(DISTINCT test_table.name) AS unique_names, formatDateTime(test_table.created_at, \'Y-m-d\', \'Europe/Amsterdam\') AS date FROM test_table GROUP BY test_table.id, created_at');
    });
  });
}); 
