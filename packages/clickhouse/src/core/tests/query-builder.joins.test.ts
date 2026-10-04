import type { Equal, Expect } from '@type-challenges/utils';
import { setupTestBuilder } from './test-utils.js';
import { SQLFormatter } from '../formatters/sql-formatter.js';
import { transformSelectQueryNode } from '../query-node.js';

describe('QueryBuilder - Joins', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('composite keys', () => {
    it.each([
      ['innerJoin', 'INNER'], ['leftJoin', 'LEFT'], ['leftAnyJoin', 'LEFT ANY'],
      ['rightJoin', 'RIGHT'], ['fullJoin', 'FULL'],
    ] as const)('renders all keys for %s', (method, type) => {
      for (const alias of [undefined, 'u'] as const) {
        const keys = [
          ['created_by', 'users.id'], ['name', 'users.user_name'], ['created_at', 'users.created_at'],
        ] as const;
        const query = {
          innerJoin: builder.innerJoin('users', keys, alias),
          leftJoin: builder.leftJoin('users', keys, alias),
          leftAnyJoin: builder.leftAnyJoin('users', keys, alias),
          rightJoin: builder.rightJoin('users', keys, alias),
          fullJoin: builder.fullJoin('users', keys, alias),
        }[method];
        const qualifier = alias ?? 'users';
        expect(query.toSQLWithParams()).toEqual({
          sql: `SELECT * FROM test_table ${type} JOIN users${alias ? ` AS ${alias}` : ''} ON created_by = ${qualifier}.id AND name = ${qualifier}.user_name AND created_at = ${qualifier}.created_at`,
          parameters: [],
        });
      }
    });

    it('renders a one-pair array exactly like a legacy join', () => {
      expect(builder.innerJoin('users', [['id', 'users.id']]).getQueryNode())
        .toEqual(builder.innerJoin('users', 'id', 'users.id').getQueryNode());
    });

    it('rewrites all right qualifiers in independently aliased joins', () => {
      const keys = [['created_by', 'users.id'], ['name', 'users.user_name']] as const;
      const query = builder.innerJoin('users', keys, 'creator')
        .leftAnyJoin('users', [['updated_by', 'users.id'], ['name', 'users.user_name']], 'updater')
        .select(['creator.email as creator_email', 'updater.email as updater_email']);
      expect(query.toSQL()).toBe('SELECT creator.email as creator_email, updater.email as updater_email FROM test_table INNER JOIN users AS creator ON created_by = creator.id AND name = creator.user_name LEFT ANY JOIN users AS updater ON updated_by = updater.id AND name = updater.user_name');
    });

    it.each(['leftJoin', 'leftAnyJoin'] as const)('keeps %s ON filters as bound literals', method => {
      const query = builder[method]('users', [['created_by', 'users.id'], ['name', 'users.user_name']], 'u', [
        { column: 'u.user_name', operator: 'eq', value: 'users.user_name' },
        { column: 'u.is_active', operator: 'eq', value: true },
      ]).where('id', 'gt', 5);
      expect(query.toSQLWithParams().parameters).toEqual(['users.user_name', true, 5]);
      expect(query.toSQLWithParams().sql).toContain('ON created_by = u.id AND name = u.user_name AND u.user_name = ? AND u.is_active = ?');
    });

    it('joins a typed CTE and preserves CTE, ON, and WHERE parameter order', () => {
      const query = builder.withCTE('children', {
        sql: 'SELECT {parent_id:Int32} AS parent_id, {label:String} AS label', parameters: { parent_id: 7, label: 'child' },
      }, { parent_id: 'Int32', label: 'String' })
        .leftAnyJoin('children', [['created_by', 'children.parent_id'], ['name', 'children.label']], undefined,
          { column: 'children.label', operator: 'neq', value: 'hidden' })
        .where('active', 'eq', 1);
      expect(query.toSQLWithParams()).toEqual({
        sql: "WITH children AS (SELECT CAST(?, 'Int32') AS parent_id, CAST(?, 'String') AS label) SELECT * FROM test_table LEFT ANY JOIN children ON created_by = children.parent_id AND name = children.label AND children.label != ? WHERE active = ?",
        parameters: [7, 'child', 'hidden', 1],
      });
    });

    it('copies input keys and returned query-node/config keys', () => {
      const keys: [['created_by', 'users.id'], ['name' | 'created_by', 'users.user_name' | 'users.email']] = [
        ['created_by', 'users.id'], ['name', 'users.user_name'],
      ];
      const query = builder.innerJoin('users', keys);
      const sibling = query.where('id', 'gt', 0);
      const sql = query.toSQL();
      keys[1][0] = 'created_by';
      keys[1][1] = 'users.email';
      keys.splice(1, 1);
      for (const node of [query.getQueryNode(), query.toQueryNode(), query.getConfig()]) {
        expect(node.joins?.[0].additionalKeys).toEqual([{ leftColumn: 'name', rightColumn: 'users.user_name' }]);
        node.joins![0].additionalKeys![0].rightColumn = 'users.email';
      }
      expect(query.toSQL()).toBe(sql);
      expect(sibling.toSQL()).toBe(`${sql} WHERE id > 0`);
      expect(builder.getQueryNode().joins).toBeUndefined();
    });

    it('qualifies additional left keys consistently with relationship join sources', () => {
      const node = builder.innerJoin('users', [['created_by', 'users.id'], ['name', 'users.user_name']]).getQueryNode();
      const join = node.joins![0];
      join.leftSource = 'source';
      join.additionalKeys!.push({ leftColumn: 'already.qualified', rightColumn: 'users.email' });
      expect(new SQLFormatter().compileJoins(node)).toEqual({
        query: 'INNER JOIN users ON source.created_by = users.id AND source.name = users.user_name AND already.qualified = users.email',
        parameters: [],
      });
    });

    it('preserves additional keys through query transforms without sharing objects', () => {
      const query = builder.innerJoin('users', [['created_by', 'users.id'], ['name', 'users.user_name']]);
      const original = query.getQueryNode();
      const transformed = transformSelectQueryNode(original, [node => {
        node.joins![0].additionalKeys![0].rightColumn = 'users.email';
        return node;
      }]);
      expect(new SQLFormatter().compileJoins(transformed).query)
        .toBe('INNER JOIN users ON created_by = users.id AND name = users.email');
      expect(original.joins![0].additionalKeys![0].rightColumn).toBe('users.user_name');
      expect(query.getQueryNode()).toEqual(original);
    });

    it.each([[], [['id']], [['id', 'users.id', 'extra']], [['id', 7]], [null], [['', 'users.id']], [['id', '']], Array(1), [['id', ,]]].map(keys => ({ keys })))(
      'rejects malformed key arrays ($keys)', ({ keys }) => {
        expect(() => builder.innerJoin('users', keys as any)).toThrow(/join (requires|key)/);
      },
    );
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
      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users AS u1 ON created_by = u1.id INNER JOIN users AS u2 ON updated_by = u2.id');
    });

    it('should parameterize additional LEFT JOIN conditions', () => {
      const { sql, parameters } = builder
        .leftJoin('users', 'created_by', 'users.id', 'user', {
          column: 'user.status',
          operator: 'eq',
          value: 'active',
        })
        .toSQLWithParams();

      expect(sql).toBe(
        'SELECT * FROM test_table LEFT JOIN users AS user ON created_by = user.id AND user.status = ?',
      );
      expect(parameters).toEqual(['active']);
    });


    it('compiles composite single-match joins and parameterizes extra predicates', () => {
      const { sql, parameters } = builder.leftAnyJoinOn('users', [
        { leftColumn: 'created_by', rightColumn: 'users.id' },
        { leftColumn: 'updated_by', rightColumn: 'users.id' },
      ], 'user', { column: 'user.status', operator: 'eq', value: 'active' }).toSQLWithParams();
      expect(sql).toBe('SELECT * FROM test_table LEFT ANY JOIN users AS user ON created_by = user.id AND updated_by = user.id AND user.status = ?');
      expect(parameters).toEqual(['active']);
    });

    it('should maintain types when joining on same column name', () => {
      const _query = builder
        .select(['id'])
        .innerJoin(
          'users',
          'id',
          'users.id'
        );

      type Result = Awaited<ReturnType<typeof _query.execute>>;
      type Expected = { id: number }[];
      type _Assert = Expect<Equal<Result, Expected>>;
    });

    it('should use the join alias in the ON clause when an alias is provided', () => {
      const sql = builder
        .innerJoin('users', 'created_by', 'users.id', 'author')
        .select(['author.user_name'])
        .toSQL();

      expect(sql).toBe(
        'SELECT author.user_name FROM test_table INNER JOIN users AS author ON created_by = author.id'
      );
    });

    it('requires aliases when selecting duplicate leaf column names from joined tables', () => {
      const _query = builder
        .innerJoin('users', 'created_by', 'users.id')
        .select(['test_table.id', 'users.id']);

      type Result = Awaited<ReturnType<typeof _query.execute>>;
      type Expected = { id: number }[];
      type _Assert = Expect<Equal<Result, Expected>>;
    });
  });

  describe('type safety', () => {
    it('should maintain column types from joined tables', () => {
      const _query = builder
        .innerJoin(
          'users',
          'created_by',
          'users.id'
        )
        .select(['name', 'users.user_name', 'users.email']);

      type Result = Awaited<ReturnType<typeof _query.execute>>;
      type Expected = {
        name: string;
        user_name: string;
        email: string;
      }[];

      type _Assert = Expect<Equal<Result, Expected>>;
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

    it('should support LEFT ANY JOIN', () => {
      const sql = builder
        .leftAnyJoin(
          'users',
          'created_by',
          'users.id',
          'user'
        )
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table LEFT ANY JOIN users AS user ON created_by = user.id');
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
        .select(['test_table.id', 'test_table.name', 'users.user_name', 'users.email'])
        .toSQL();
      expect(sql).toBe('SELECT test_table.id, test_table.name, users.user_name, users.email FROM test_table INNER JOIN users ON created_by = users.id');
    });

    it('should handle multiple joins with column selection', () => {
      const _query = builder
        .innerJoin('users', 'created_by', 'users.id', 'u1')
        .leftJoin('users', 'updated_by', 'users.id', 'u2')
        .select(['test_table.name', 'u1.user_name as creator', 'u2.user_name as updater']);

      type Result = Awaited<ReturnType<typeof _query.execute>>;
      type Expected = {
        name: string;
        creator: string;
        updater: string;
      }[];
      type _Assert = Expect<Equal<Result, Expected>>;

      const sql = _query.toSQL();
      expect(sql).toBe(
        'SELECT test_table.name, u1.user_name as creator, u2.user_name as updater ' +
        'FROM test_table ' +
        'INNER JOIN users AS u1 ON created_by = u1.id ' +
        'LEFT JOIN users AS u2 ON updated_by = u2.id'
      );
    });

    describe('type safety for column selection', () => {
    it('should maintain correct types for joined table columns', () => {
      const _query = builder
        .innerJoin(
          'users',
          'created_by',
            'users.id'
          )
          .select(['test_table.price', 'users.user_name'] as const);

        type Result = Awaited<ReturnType<typeof _query.execute>>;
        type Expected = {
          price: number;
          user_name: string;
        }[];

        type _Assert = Expect<Equal<Result, Expected>>;
      });

      it('should allow aggregating qualified columns from joined tables', () => {
        const _query = builder
          .innerJoin('users', 'created_by', 'users.id')
          .select(['users.user_name'])
          .count('users.id', 'user_count')
          .groupBy('users.user_name');

        type Result = Awaited<ReturnType<typeof _query.execute>>;
        type Expected = {
          user_name: string;
          user_count: string;
        }[];

        type _Assert = Expect<Equal<Result, Expected>>;

        expect(_query.toSQL()).toBe(
          'SELECT users.user_name, COUNT(users.id) AS user_count FROM test_table INNER JOIN users ON created_by = users.id GROUP BY users.user_name'
        );
      });
    });

    describe('join chain type safety', () => {
      it('should maintain types through multiple joins', () => {
        const _query = builder
          .innerJoin('users', 'created_by', 'users.id')
          .select(['test_table.price', 'users.user_name']);

        type Result = Awaited<ReturnType<typeof _query.execute>>;
        type Expected = {
          price: number;
          user_name: string;
        }[];

        type _Assert = Expect<Equal<Result, Expected>>;
      });

    });

    it('should allow grouping, ordering, and having using joined table columns', () => {
      const sql = builder
        .innerJoin('users', 'created_by', 'users.id')
        .select(['users.user_name', 'test_table.name'])
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

    it('should preserve join, aggregation, and having nodes in the query tree', () => {
      const query = builder
        .innerJoin('users', 'created_by', 'users.id', 'author')
        .select(['author.user_name'])
        .sum('price', 'revenue')
        .count('id', 'order_count')
        .where('active', 'eq', 1)
        .groupBy('author.user_name')
        .having('revenue > ?', [1000])
        .having('order_count > ?', [5])
        .orderBy('author.user_name', 'DESC');

      expect(query.toSQL()).toBe(
        "SELECT author.user_name, SUM(price) AS revenue, COUNT(id) AS order_count FROM test_table " +
        "INNER JOIN users AS author ON created_by = author.id " +
        "WHERE active = 1 " +
        "GROUP BY author.user_name " +
        "HAVING revenue > 1000 AND order_count > 5 " +
        "ORDER BY author.user_name DESC"
      );

      const queryNode = query.toQueryNode();
      expect(queryNode.joins?.map(join => [join.type, join.table, join.alias])).toEqual([
        ['INNER', 'users', 'author'],
      ]);
      expect(queryNode.select?.map(item => item.selection)).toEqual([
        'author.user_name',
        'SUM(price) AS revenue',
        'COUNT(id) AS order_count',
      ]);
      expect(queryNode.having?.map(item => item.expression)).toEqual([
        'revenue > ?',
        'order_count > ?',
      ]);
    });

  });
}); 
