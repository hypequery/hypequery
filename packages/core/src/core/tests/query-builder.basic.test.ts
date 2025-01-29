import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Basic Operations', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], true, {}>;

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
}); 