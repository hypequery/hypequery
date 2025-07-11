import { createQueryBuilder } from '../query-builder';

interface TestSchema {
  test_table: {
    id: 'Int32';
    name: 'String';
    created_by: 'Int32';
    updated_by: 'Int32';
  };
  users: {
    id: 'Int32';
    user_name: 'String';
    email: 'String';
  };
}

describe('Conditional Joins', () => {
  const db = createQueryBuilder<TestSchema>({
    host: 'http://localhost:8123',
    username: 'default',
    password: 'password',
    database: 'test_db'
  });

  it('should build dynamic joins based on conditions', () => {
    function buildUserQuery(includeCreator: boolean, includeUpdater: boolean) {
      let query = db.table('test_table').select(['id', 'name']);

      if (includeCreator) {
        query = query.leftJoin('users', 'created_by', 'users.id');
      }

      if (includeUpdater) {
        query = query.leftJoin('users', 'updated_by', 'users.id', 'updater');
      }

      return query;
    }

    // Test with creator only
    const creatorOnlyQuery = buildUserQuery(true, false);
    const creatorOnlySQL = creatorOnlyQuery.toSQL();
    expect(creatorOnlySQL).toContain('LEFT JOIN users ON created_by = users.id');
    expect(creatorOnlySQL).not.toContain('updater');

    // Test with updater only
    const updaterOnlyQuery = buildUserQuery(false, true);
    const updaterOnlySQL = updaterOnlyQuery.toSQL();
    expect(updaterOnlySQL).toContain('LEFT JOIN users AS updater ON updated_by = users.id');
    expect(updaterOnlySQL).not.toContain('users ON created_by');

    // Test with both
    const bothQuery = buildUserQuery(true, true);
    const bothSQL = bothQuery.toSQL();
    expect(bothSQL).toContain('LEFT JOIN users ON created_by = users.id');
    expect(bothSQL).toContain('LEFT JOIN users AS updater ON updated_by = users.id');

    // Test with neither
    const neitherQuery = buildUserQuery(false, false);
    const neitherSQL = neitherQuery.toSQL();
    expect(neitherSQL).not.toContain('JOIN');
  });

  it('should handle complex conditional join scenarios', () => {
    function buildComplexQuery(options: {
      includeCreator?: boolean;
      includeUpdater?: boolean;
      includeDepartment?: boolean;
      joinType?: 'LEFT' | 'INNER';
    }) {
      let query = db.table('test_table').select(['id', 'name']);

      if (options.includeCreator) {
        if (options.joinType === 'INNER') {
          query = query.innerJoin('users', 'created_by', 'users.id', 'creator');
        } else {
          query = query.leftJoin('users', 'created_by', 'users.id', 'creator');
        }
      }

      if (options.includeUpdater) {
        query = query.leftJoin('users', 'updated_by', 'users.id', 'updater');
      }

      return query;
    }

    // Test with INNER join for creator
    const innerJoinQuery = buildComplexQuery({
      includeCreator: true,
      includeUpdater: false,
      joinType: 'INNER'
    });
    const innerJoinSQL = innerJoinQuery.toSQL();
    expect(innerJoinSQL).toContain('INNER JOIN users AS creator ON created_by = users.id');
    expect(innerJoinSQL).not.toContain('LEFT JOIN');

    // Test with LEFT join for creator
    const leftJoinQuery = buildComplexQuery({
      includeCreator: true,
      includeUpdater: false,
      joinType: 'LEFT'
    });
    const leftJoinSQL = leftJoinQuery.toSQL();
    expect(leftJoinSQL).toContain('LEFT JOIN users AS creator ON created_by = users.id');
  });

  it('should maintain type safety in conditional joins', () => {
    function buildTypedQuery(includeCreator: boolean) {
      let query = db.table('test_table').select(['id', 'name']);

      if (includeCreator) {
        query = query.leftJoin('users', 'created_by', 'users.id');
        // The query should be valid and executable
        expect(() => query.toSQL()).not.toThrow();
      }

      return query;
    }

    const query = buildTypedQuery(true);
    const sql = query.toSQL();
    expect(sql).toContain('LEFT JOIN users ON created_by = users.id');
  });
}); 