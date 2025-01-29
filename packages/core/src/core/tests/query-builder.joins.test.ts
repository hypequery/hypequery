import { Equal, Expect } from '@type-challenges/utils';
import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Joins', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], true, {}>;

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
      type Expected = {
        'test_table.id': number;
        'users.id': number;
      }[];
      // @ts-expect-error - test_table.id is not a valid column name
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
        .select(['name', 'user_name', 'email']);

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = {
        name: string;
        user_name: string;
        email: string;
      }[];

      type Assert = Expect<Equal<Result, Expected>>;
    });

    it('should only allow joining to valid tables', () => {
      // @ts-expect-error - invalid table
      builder.innerJoin('invalid_table', 'created_by', 'users.id');

      // @ts-expect-error - invalid column
      builder.innerJoin('users', 'invalid_column', 'users.id');

      // @ts-expect-error - invalid join column
      builder.innerJoin('users', 'created_by', 'users.invalid_column');

      // This should type check
      builder.innerJoin('users', 'created_by', 'users.id');
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
        .select(['test_table.id', 'test_table.name', 'users.user_name', 'users.email'])
        .innerJoin(
          'users',
          'created_by',
          'users.id'
        )
        .toSQL();
      expect(sql).toBe('SELECT test_table.id, test_table.name, users.user_name, users.email FROM test_table INNER JOIN users ON created_by = users.id');
    });

    it('should handle multiple joins with column selection', () => {
      const sql = builder
        .select(['test_table.name', 'u1.user_name as creator', 'u2.user_name as updater'])
        .innerJoin('users', 'created_by', 'users.id', 'u1')
        .leftJoin('users', 'updated_by', 'users.id', 'u2')
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
          .select(['test_table.price', 'users.user_name'])
          .innerJoin(
            'users',
            'created_by',
            'users.id'
          );


        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
          'test_table.price': number;
          'users.user_name': string;
        }[];

        type Assert = Expect<Equal<Result, Expected>>;
      });
    });

    describe('join chain type safety', () => {
      it('should maintain types through multiple joins', () => {
        const query = builder
          .innerJoin('users', 'created_by', 'users.id')
          .select(['test_table.price', 'users.user_name']);

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
          'test_table.price': number;
          'users.user_name': string;
        }[];

        type Assert = Expect<Equal<Result, Expected>>;
      });

    });

  });
}); 
