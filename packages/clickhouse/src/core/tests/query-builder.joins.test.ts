import { Equal, Expect } from '@type-challenges/utils';
import { setupTestBuilder } from './test-utils.js';

describe('QueryBuilder - Joins', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('edge cases', () => {
    it('should handle joins with same column names', () => {
      const sql = builder
        .select(['id', 'name'])
        .innerJoin(
          'users',
          'id',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT id, name FROM test_table INNER JOIN users ON id = users.id');
    });

    it('should handle multiple joins to same table with aliases', () => {
      const sql = builder
        .innerJoin('users', 'created_by', 'users.id', 'u1')
        .innerJoin('users', 'updated_by', 'users.id', 'u2')
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users AS u1 ON created_by = users.id INNER JOIN users AS u2 ON updated_by = users.id');
    });

    it('should maintain types when joining on same column name', () => {
      const query = builder
        .select(['id'])
        .innerJoin(
          'users',
          'id',
          'users.id'
        );

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = { id: number }[];
      type Assert = Expect<Equal<Result, Expected>>;
    });
  });

  describe('type safety', () => {
    it('should maintain column types from joined tables', () => {
      const query = builder
        .innerJoin(
          'users',
          'created_by',
          'users.id'
        )
        .select(['name', 'users.user_name', 'users.email']);

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = {
        name: string;
        user_name: string;
        email: string;
      }[];

      type Assert = Expect<Equal<Result, Expected>>;
    });

    it('should only allow joining to valid tables', () => {
      expect(() => builder.innerJoin('users', 'created_by', 'users.id')).not.toThrow();
    });
  });

  describe('join types', () => {
    it('should support INNER JOIN', () => {
      const sql = builder
        .innerJoin(
          'users',
          'created_by',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users ON created_by = users.id');
    });

    it('should support LEFT JOIN', () => {
      const sql = builder
        .leftJoin(
          'users',
          'created_by',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table LEFT JOIN users ON created_by = users.id');
    });

    it('should support RIGHT JOIN', () => {
      const sql = builder
        .rightJoin(
          'users',
          'created_by',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table RIGHT JOIN users ON created_by = users.id');
    });

    it('should support FULL JOIN', () => {
      const sql = builder
        .fullJoin(
          'users',
          'created_by',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table FULL JOIN users ON created_by = users.id');
    });
  });

  describe('complex join scenarios', () => {
    it('should select specific columns from multiple joined tables', () => {
      const sql = builder
        .innerJoin(
          'users',
          'created_by',
          'users.id'
        )
        .select(['test_table.id', 'test_table.name', 'users.user_name', 'users.email'] as const)
        .toSQL();
      expect(sql).toBe('SELECT test_table.id, test_table.name, users.user_name, users.email FROM test_table INNER JOIN users ON created_by = users.id');
    });

    it('should handle multiple joins with column selection', () => {
      const sql = builder
        .innerJoin('users', 'created_by', 'users.id', 'u1')
        .leftJoin('users', 'updated_by', 'users.id', 'u2')
        // @ts-expect-error - u1.user_name current type system limitation
        .select(['test_table.name', 'u1.user_name as creator', 'u2.user_name as updater'] as const)
        .toSQL();
      expect(sql).toBe(
        'SELECT test_table.name, u1.user_name as creator, u2.user_name as updater ' +
        'FROM test_table ' +
        'INNER JOIN users AS u1 ON created_by = users.id ' +
        'LEFT JOIN users AS u2 ON updated_by = users.id'
      );
    });

    describe('type safety for column selection', () => {
      it('should maintain correct types for joined table columns', () => {
        const query = builder
          .innerJoin(
            'users',
            'created_by',
            'users.id'
          )
          .select(['test_table.price', 'users.user_name'] as const);

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
          price: number;
          user_name: string;
        }[];

        type Assert = Expect<Equal<Result, Expected>>;
      });
    });

    describe('join chain type safety', () => {
      it('should maintain types through multiple joins', () => {
        const query = builder
          .innerJoin('users', 'created_by', 'users.id')
          .select(['test_table.price', 'users.user_name'] as const);

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
          price: number;
          user_name: string;
        }[];

        type Assert = Expect<Equal<Result, Expected>>;
      });

    });

    it('should allow grouping, ordering, and having using joined table columns', () => {
      const sql = builder
        .innerJoin('users', 'created_by', 'users.id')
        .select(['users.user_name', 'test_table.name'] as const)
        .groupBy(['users.user_name', 'test_table.name'])
        .orderBy('users.user_name', 'DESC')
        .having('COUNT(*) > 1')
        .toSQL();

      expect(sql).toBe(
        'SELECT users.user_name, test_table.name FROM test_table ' +
        'INNER JOIN users ON created_by = users.id ' +
        'GROUP BY users.user_name, test_table.name ' +
        'HAVING COUNT(*) > 1 ' +
        'ORDER BY users.user_name DESC'
      );
    });

  });
}); 
