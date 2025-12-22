import { setupTestBuilder } from './test-utils.js';
import { rawAs } from '../utils/sql-expressions.js';

describe('QueryBuilder - Basic Operations', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('select', () => {
    it('should build SELECT query with specific columns', () => {
      const sql = builder
        .select(['id', 'name'])
        .toSQL();
      expect(sql).toBe('SELECT id, name FROM test_table');
    });

    it('should handle empty select', () => {
      const sql = builder.toSQL();
      expect(sql).toBe('SELECT * FROM test_table');
    });

    it('should handle select("*") for all columns', () => {
      const sql = builder
        .select('*')
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table');
    });

    it('should handle select("*") with additional clauses', () => {
      const sql = builder
        .select('*')
        .where('id', 'gt', 1)
        .limit(10)
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE id > 1 LIMIT 10');
    });
  });

  describe('distinct', () => {
    it('should add DISTINCT keyword', () => {
      const sql = builder
        .distinct()
        .select(['name'])
        .toSQL();
      expect(sql).toBe('SELECT DISTINCT name FROM test_table');
    });
  });

  describe('expressions and aliases', () => {
    it('should support selecting expressions and filtering via HAVING with the alias', () => {
      const sql = builder
        .select([rawAs<number, 'avg_price'>('AVG(price)', 'avg_price')] as const)
        .having('avg_price > 10')
        .toSQL();

      expect(sql).toBe('SELECT AVG(price) AS avg_price FROM test_table HAVING avg_price > 10');
    });
  });
}); 
