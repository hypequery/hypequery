import { QueryBuilder } from '../query-builder.js';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Grouping and Ordering', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], true, {}>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('GROUP BY', () => {
    it('should add GROUP BY for single column', () => {
      const sql = builder
        .select(['name'])
        .sum('price')
        .groupBy('name')
        .toSQL();
      expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
    });

    it('should add GROUP BY for multiple columns', () => {
      const sql = builder
        .select(['name', 'created_at'])
        .sum('price')
        .groupBy(['name', 'created_at'])
        .toSQL();
      expect(sql).toBe('SELECT name, created_at, SUM(price) AS price_sum FROM test_table GROUP BY name, created_at');
    });
  });

  describe('ORDER BY', () => {
    it('should add ORDER BY clause', () => {
      const sql = builder
        .select(['name', 'price'])
        .orderBy('price', 'DESC')
        .toSQL();
      expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC');
    });

    it('should combine multiple ORDER BY clauses', () => {
      const sql = builder
        .select(['name', 'price'])
        .orderBy('price', 'DESC')
        .orderBy('name', 'ASC')
        .toSQL();
      expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC, name ASC');
    });
  });
}); 