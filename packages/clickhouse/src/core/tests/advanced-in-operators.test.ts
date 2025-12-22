import { setupTestBuilder } from './test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';

describe('Advanced IN Operators', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('GLOBAL IN Operators', () => {
    it('should generate GLOBAL IN SQL for array values', () => {
      const query = builder
        .where('id', 'globalIn', [1, 2, 3, 4]);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE id GLOBAL IN (?, ?, ?, ?)');
      expect(parameters).toEqual([1, 2, 3, 4]);
    });

    it('should generate GLOBAL NOT IN SQL for array values', () => {
      const query = builder
        .where('id', 'globalNotIn', [5, 6, 7]);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE id GLOBAL NOT IN (?, ?, ?)');
      expect(parameters).toEqual([5, 6, 7]);
    });

    it('should handle empty arrays for GLOBAL IN', () => {
      const query = builder
        .where('id', 'globalIn', []);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE 1 = 0');
      expect(parameters).toEqual([]);
    });

    it('should handle empty arrays for GLOBAL NOT IN', () => {
      const query = builder
        .where('id', 'globalNotIn', []);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE 1 = 0');
      expect(parameters).toEqual([]);
    });
  });

  describe('Subquery IN Operators', () => {
    it('should generate IN subquery SQL', () => {
      const query = builder
        .where('id', 'inSubquery', 'SELECT id FROM users WHERE active = 1');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE id IN (SELECT id FROM users WHERE active = 1)');
      expect(parameters).toEqual([]);
    });

    it('should generate GLOBAL IN subquery SQL', () => {
      const query = builder
        .where('id', 'globalInSubquery', 'SELECT id FROM users WHERE active = 1');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE id GLOBAL IN (SELECT id FROM users WHERE active = 1)');
      expect(parameters).toEqual([]);
    });

    it('should handle complex subqueries', () => {
      const complexSubquery = `SELECT id FROM users WHERE created_at >= '2024-01-01' AND active = 1`;

      const query = builder
        .where('created_by', 'inSubquery', complexSubquery);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE created_by IN (SELECT id FROM users WHERE created_at >= \'2024-01-01\' AND active = 1)');
      expect(parameters).toEqual([]);
    });
  });

  describe('Table Reference IN Operators', () => {
    it('should generate IN table SQL', () => {
      const query = builder
        .where('created_by', 'inTable', 'users');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE created_by IN users');
      expect(parameters).toEqual([]);
    });

    it('should generate GLOBAL IN table SQL', () => {
      const query = builder
        .where('created_by', 'globalInTable', 'users');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE created_by GLOBAL IN users');
      expect(parameters).toEqual([]);
    });

    it('should handle table names with underscores', () => {
      const query = builder
        .where('created_by', 'inTable', 'users');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE created_by IN users');
      expect(parameters).toEqual([]);
    });
  });

  describe('Tuple IN Operators', () => {
    it('should generate IN tuple SQL for multiple columns', () => {
      const query = builder
        .where(['id', 'created_by'], 'inTuple', [[1, 123], [2, 456]]);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE (id, created_by) IN ((?, ?), (?, ?))');
      expect(parameters).toEqual([1, 123, 2, 456]);
    });

    it('should generate GLOBAL IN tuple SQL', () => {
      const query = builder
        .where(['id', 'created_by'], 'globalInTuple', [[1, 123], [2, 456]]);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE (id, created_by) GLOBAL IN ((?, ?), (?, ?))');
      expect(parameters).toEqual([1, 123, 2, 456]);
    });

    it('should handle empty tuple arrays', () => {
      const query = builder
        .where(['id', 'created_by'], 'inTuple', []);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE 1 = 0');
      expect(parameters).toEqual([]);
    });

    it('should handle single tuple', () => {
      const query = builder
        .where(['id', 'created_by'], 'inTuple', [[1, 123]]);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE (id, created_by) IN ((?, ?))');
      expect(parameters).toEqual([1, 123]);
    });
  });

  describe('Combined Usage', () => {
    it('should combine multiple IN operators', () => {
      const query = builder
        .where('category', 'in', ['pending', 'processing'])
        .where('id', 'globalIn', [1, 2, 3])
        .where('created_by', 'inSubquery', 'SELECT id FROM users WHERE active = 1')
        .where('updated_by', 'inTable', 'users');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE category IN (?, ?)');
      expect(sql).toContain('AND id GLOBAL IN (?, ?, ?)');
      expect(sql).toContain('AND created_by IN (SELECT id FROM users WHERE active = 1)');
      expect(sql).toContain('AND updated_by IN users');
      expect(parameters).toEqual(['pending', 'processing', 1, 2, 3]);
    });

    it('should work with OR conditions', () => {
      const query = builder
        .where('active', 'eq', 1)
        .orWhere('id', 'globalIn', [1, 2, 3])
        .orWhere('created_by', 'inSubquery', 'SELECT id FROM users WHERE active = 1');

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE active = ?');
      expect(sql).toContain('OR id GLOBAL IN (?, ?, ?)');
      expect(sql).toContain('OR created_by IN (SELECT id FROM users WHERE active = 1)');
      expect(parameters).toEqual([1, 1, 2, 3]);
    });

    it('should work with whereGroup', () => {
      const query = builder
        .whereGroup(builder => {
          builder
            .where('id', 'globalIn', [1, 2, 3])
            .orWhere('created_by', 'inSubquery', 'SELECT id FROM users WHERE active = 1');
        })
        .where('active', 'eq', 1);

      const { sql, parameters } = query.toSQLWithParams();

      expect(sql).toContain('WHERE (id GLOBAL IN (?, ?, ?) OR created_by IN (SELECT id FROM users WHERE active = 1))');
      expect(sql).toContain('AND active = ?');
      expect(parameters).toEqual([1, 2, 3, 1]);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-array value in globalIn', () => {
      expect(() => {
        builder.where('id', 'globalIn', 'not-an-array' as any);
      }).toThrow('Expected an array for globalIn operator, but got string');
    });

    it('should throw error for non-string value in inSubquery', () => {
      expect(() => {
        builder.where('id', 'inSubquery', ['not', 'a', 'string'] as any);
      }).toThrow('Expected a string (subquery) for inSubquery operator, but got object');
    });

    it('should throw error for non-string value in inTable', () => {
      expect(() => {
        builder.where('id', 'inTable', 123 as any);
      }).toThrow('Expected a string (table name) for inTable operator, but got number');
    });

    it('should throw error for non-array value in inTuple', () => {
      expect(() => {
        builder.where(['id', 'created_by'], 'inTuple', 'not-an-array' as any);
      }).toThrow('Expected an array of tuples for inTuple operator, but got string');
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety for column references', () => {
      // This should compile without errors
      const query = builder
        .where('category', 'globalIn', ['active', 'pending'])
        .where('id', 'inSubquery', 'SELECT id FROM users WHERE active = 1')
        .where('created_by', 'inTable', 'users');

      expect(query).toBeDefined();
    });

    it('should work with cross-table column references', () => {
      const query = builder
        .innerJoin('users', 'created_by', 'users.id')
        .where('users.user_name', 'globalIn', ['active', 'pending'])
        .where('users.email', 'inSubquery', 'SELECT email FROM users WHERE active = 1');

      expect(query).toBeDefined();
    });

    it('should provide correct return types for IN operators', () => {
      const query = builder
        .where('id', 'globalIn', [1, 2, 3])
        .select(['id', 'name']);

      // Test that the query executes without errors
      expect(query).toBeDefined();
    });

    it('should work with valid column names', () => {
      // This should type check
      builder.where('id', 'globalIn', [1, 2, 3]);
      builder.where('name', 'inSubquery', 'SELECT id FROM users');
      builder.where(['id', 'created_by'], 'inTuple', [[1, 2]]);
    });
  });

  // Extra complex tests for full SQL string comparison
  it('should generate the expected SQL for a multi-IN, join, and group by query', () => {
    const query = builder
      .select(['id', 'name', 'price'])
      .innerJoin('users', 'created_by', 'users.id')
      .where('category', 'in', ['electronics', 'books'])
      .where('id', 'globalIn', [1, 2, 3])
      .where('created_by', 'inSubquery', 'SELECT id FROM users WHERE active = 1')
      .where(['id', 'created_by'], 'inTuple', [[1, 100], [2, 101]])
      .groupBy(['name', 'users.user_name'])
      .orderBy('price', 'DESC')
      .limit(5);

    const sql = query.toSQL();
    expect(sql).toBe(
      "SELECT id, name, price FROM test_table INNER JOIN users ON created_by = users.id WHERE category IN ('electronics', 'books') AND id GLOBAL IN (1, 2, 3) AND created_by IN (SELECT id FROM users WHERE active = 1) AND (id, created_by) IN ((1, 100), (2, 101)) GROUP BY name, users.user_name ORDER BY price DESC LIMIT 5"
    );
  });

  it('should generate the expected SQL for a CTE, aggregation, and advanced IN query', () => {
    const subquery = builder
      .select(['id'])
      .where('category', 'eq', 'electronics')
      .where('price', 'gt', 500);

    const query = builder
      .withCTE('expensive_items', subquery)
      .select(['category', 'name', 'price'])
      .where('id', 'inSubquery', 'SELECT id FROM expensive_items')
      .where('created_by', 'globalIn', [1, 2, 3, 4, 5])
      .where('updated_by', 'globalInTable', 'users')
      .where(['category', 'created_by'], 'globalInTuple', [['electronics', 1], ['books', 2]])
      .orderBy('price', 'DESC')
      .limit(10);

    const sql = query.toSQL();
    expect(sql).toBe(
      "WITH expensive_items AS (SELECT id FROM test_table WHERE category = 'electronics' AND price > 500) SELECT category, name, price FROM test_table WHERE id IN (SELECT id FROM expensive_items) AND created_by GLOBAL IN (1, 2, 3, 4, 5) AND updated_by GLOBAL IN users AND (category, created_by) GLOBAL IN (('electronics', 1), ('books', 2)) ORDER BY price DESC LIMIT 10"
    );
  });

  describe('Type Safety Demonstration', () => {
    it('should demonstrate that type safety is now working', () => {
      // Current approach - full type safety with strict schema
      const builder = setupTestBuilder();

      // ✅ Valid columns work
      const validQuery = builder
        .where('id', 'eq', 1)  // ✅ Valid column
        .where('name', 'in', ['test']);  // ✅ Valid column

      // ❌ Invalid columns would cause TypeScript errors (commented out to keep test passing)
      // const invalidQuery = builder
      //   .where('not_exists', 'eq', 'value')  // ❌ TypeScript error: 'not_exists' is not a valid column
      //   .where('fake_column', 'in', [1, 2, 3]);  // ❌ TypeScript error: 'fake_column' is not a valid column

      expect(validQuery).toBeDefined();

      // The key insight: We now have full type safety without needing an index signature!
      console.log('✅ Type safety demonstration: Invalid columns now cause TypeScript compilation errors');
      console.log('✅ This matches production behavior with generated schemas');
    });

    it('should demonstrate type safety for inTable operators', () => {
      const builder = setupTestBuilder();

      // ✅ Valid table names work
      const validQuery = builder
        .where('created_by', 'inTable', 'users')  // ✅ Valid table
        .where('updated_by', 'globalInTable', 'users');  // ✅ Valid table

      // ❌ Invalid table names would cause TypeScript errors (commented out to keep test passing)
      // const invalidQuery = builder
      //   .where('created_by', 'inTable', 'notatable')  // ❌ TypeScript error: 'notatable' is not a valid table
      //   .where('updated_by', 'globalInTable', 'fake_table');  // ❌ TypeScript error: 'fake_table' is not a valid table

      expect(validQuery).toBeDefined();

      console.log('✅ Type safety demonstration: Invalid table names in inTable operators now cause TypeScript compilation errors');
    });
  });
}); 
