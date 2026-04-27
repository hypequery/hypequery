import { setupTestBuilder, setupUsersBuilder } from './test-utils.js';


describe('QueryBuilder Analytics Features', () => {
  let queryBuilder: ReturnType<typeof setupTestBuilder>;
  let builderUsers: ReturnType<typeof setupUsersBuilder>;

  beforeEach(() => {
    queryBuilder = setupTestBuilder();
    builderUsers = setupUsersBuilder();
  });

  describe('groupByTimeInterval', () => {
    it('should generate correct SQL for toStartOfInterval', () => {
      const sql = queryBuilder
        .groupByTimeInterval('created_at', '1 day')
        .toSQL();

      expect(sql).toBe(
        'SELECT * FROM test_table ' +
        'GROUP BY toStartOfInterval(created_at, INTERVAL 1 day)'
      );
    });

    it('should handle different interval methods', () => {
      const methods = [
        'toStartOfMinute',
        'toStartOfHour',
        'toStartOfDay',
        'toStartOfWeek',
        'toStartOfMonth',
        'toStartOfQuarter',
        'toStartOfYear'
      ] as const;

      methods.forEach(method => {
        const freshBuilder = setupTestBuilder();
        const sql = freshBuilder
          .groupByTimeInterval('created_at', '1 day', method)
          .toSQL();

        expect(sql).toBe(
          `SELECT * FROM test_table GROUP BY ${method}(created_at)`
        );
      });
    });

    it('should work with select and where clauses', () => {
      const sql = queryBuilder
        .select(['created_at', 'name'])
        .where('active', 'eq', 'true')
        .groupByTimeInterval('created_at', '1 hour')
        .toSQL();

      expect(sql).toBe(
        'SELECT created_at, name FROM test_table ' +
        `WHERE active = 'true' ` +
        'GROUP BY toStartOfInterval(created_at, INTERVAL 1 hour)'
      );
    });
  });

  describe('raw', () => {
    it('should add raw SQL to HAVING clause', () => {
      const sql = queryBuilder
        .raw('COUNT(*) > 5')
        .toSQL();

      expect(sql).toContain('HAVING COUNT(*) > 5');
    });

    it('should support multiple raw conditions', () => {
      const sql = queryBuilder
        .raw('COUNT(*) > 5')
        .raw('SUM(amount) < 1000')
        .toSQL();

      expect(sql).toContain('HAVING COUNT(*) > 5 AND SUM(amount) < 1000');
    });

    it('should work with group by', () => {
      const sql = queryBuilder
        .groupBy('category')
        .raw('COUNT(*) > 5')
        .toSQL();

      expect(sql).toContain('GROUP BY category');
      expect(sql).toContain('HAVING COUNT(*) > 5');
    });
  });

  describe('settings', () => {
    it('should not change rendered SQL', () => {
      const sql = queryBuilder
        .select(['id'])
        .settings({ max_execution_time: 10, final: 1 })
        .toSQL();

      expect(sql).toBe(
        'SELECT id FROM test_table'
      );
    });

    it('should merge settings across repeated calls without affecting rendered SQL', () => {
      const query = queryBuilder
        .settings({ max_execution_time: 10 })
        .settings({ final: 1 });

      expect(query.toSQL()).toBe('SELECT * FROM test_table');
      expect(query.getConfig().settings).toEqual({
        max_execution_time: 10,
        final: 1,
      });
    });
  });

  describe('final', () => {
    it('renders FINAL on the table source', () => {
      const sql = queryBuilder
        .final()
        .select(['id'])
        .toSQL();

      expect(sql).toBe('SELECT id FROM test_table FINAL');
    });
  });

  describe('withCTE', () => {
    it('should add CTE using a subquery', () => {
      const subquery = builderUsers
        .select(['id', 'user_name'])
        .where('user_name', 'eq', 'John Doe');

      const sql = queryBuilder
        .withCTE('filtered_users', subquery)
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        'WITH filtered_users AS (' +
        'SELECT id, user_name FROM users ' +
        "WHERE user_name = 'John Doe'" +
        ') ' +
        'SELECT id FROM test_table'
      );
    });

    it('should add CTE using a raw SQL string', () => {
      const sql = queryBuilder
        .withCTE('summary', 'SELECT id, SUM(value) as total FROM users GROUP BY id')
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        'WITH summary AS (' +
        'SELECT id, SUM(value) as total FROM users GROUP BY id' +
        ') ' +
        'SELECT id FROM test_table'
      );
    });

    it('should support multiple CTEs', () => {
      const sql = queryBuilder
        .withCTE('cte1', 'SELECT id FROM users')
        .withCTE('cte2', 'SELECT id FROM test_table')
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        'WITH cte1 AS (' +
        'SELECT id FROM users' +
        '), ' +
        'cte2 AS (' +
        'SELECT id FROM test_table' +
        ') ' +
        'SELECT id FROM test_table')

    })
  })

  describe('withScalar', () => {
    it('should add scalar WITH aliases without wrapping the expression in parentheses', () => {
      const sql = queryBuilder
        .withScalar('user_name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('user_id'))
        )
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        "WITH dictGet('users_dict', 'name', user_id) AS user_name " +
        'SELECT id FROM test_table'
      );
    });

    it('should support mixing scalar aliases and CTEs in insertion order', () => {
      const sql = queryBuilder
        .withScalar('user_name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('user_id'))
        )
        .withCTE('recent_ids', 'SELECT id FROM test_table WHERE price > 10')
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        "WITH dictGet('users_dict', 'name', user_id) AS user_name, " +
        'recent_ids AS (SELECT id FROM test_table WHERE price > 10) ' +
        'SELECT id FROM test_table'
      );
    });

    it('should substitute scalar expression parameters independently of query parameter order', () => {
      const sql = queryBuilder
        .where('id', 'gt', 10)
        .withScalar('user_name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('user_id'))
        )
        .select(['id'])
        .toSQL();

      expect(sql).toContain("WITH dictGet('users_dict', 'name', user_id) AS user_name");
      expect(sql).toContain('WHERE id > 10');
    });

    it('should allow scalar aliases in select, where, and groupBy', () => {
      const sql = queryBuilder
        .withScalar('user_name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('created_by'))
        )
        .select(['created_by', 'user_name'])
        .where('user_name', 'like', '%team%')
        .groupBy(['created_by', 'user_name'])
        .orderBy('user_name', 'ASC')
        .toSQL();

      expect(sql).toBe(
        "WITH dictGet('users_dict', 'name', created_by) AS user_name " +
        "SELECT created_by, user_name FROM test_table " +
        "WHERE user_name LIKE '%team%' " +
        'GROUP BY created_by, user_name ' +
        'ORDER BY user_name ASC'
      );
    });

    it('should allow ordering by a scalar alias', () => {
      const sql = queryBuilder
        .withScalar('user_name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('created_by'))
        )
        .select(['id', 'user_name'])
        .orderBy('user_name', 'DESC')
        .toSQL();

      expect(sql).toBe(
        "WITH dictGet('users_dict', 'name', created_by) AS user_name " +
        'SELECT id, user_name FROM test_table ' +
        'ORDER BY user_name DESC'
      );
    });

    it('should reject invalid scalar aliases at runtime', () => {
      expect(() =>
        queryBuilder.withScalar('user name', expr =>
          expr.ch.dictGet('users_dict', 'name', expr.col('user_id'))
        )
      ).toThrow(
        'Invalid scalar alias "user name". Use an unquoted SQL identifier (letters, numbers, underscore; cannot start with a number).'
      );
    });
  });
});
