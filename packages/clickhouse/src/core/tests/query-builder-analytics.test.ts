import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, setupUsersBuilder, TestSchema, UsersSchema } from './test-utils';


describe('QueryBuilder Analytics Features', () => {
  let queryBuilder: QueryBuilder<TestSchema, TestSchema['test_table'], true, {}>;
  let builderUsers: QueryBuilder<TestSchema, TestSchema['users'], true, {}>;

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
        .select(['created_at', 'count'])
        .where('status', 'eq', 'active')
        .groupByTimeInterval('created_at', '1 hour')
        .toSQL();

      expect(sql).toBe(
        'SELECT created_at, count FROM test_table ' +
        `WHERE status = 'active' ` +
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

  describe('withCTE', () => {
    it('should add CTE using a subquery', () => {
      const subquery = builderUsers
        .select(['id', 'name'])
        .where('active', 'eq', true);

      const sql = queryBuilder
        .withCTE('filtered_users', subquery)
        .select(['id'])
        .toSQL();

      expect(sql).toBe(
        'WITH filtered_users AS (' +
        'SELECT id, name FROM users ' +
        'WHERE active = true' +
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
});
