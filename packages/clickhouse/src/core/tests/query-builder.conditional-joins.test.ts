import { createQueryBuilder } from '../query-builder.js';

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
      const base = db.table('test_table').select(['id', 'name']);
      const withCreator = includeCreator
        ? base.leftJoin('users', 'created_by', 'users.id')
        : base;
      return includeUpdater
        ? withCreator.leftJoin('users', 'updated_by', 'users.id', 'updater')
        : withCreator;
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
      const base = db.table('test_table').select(['id', 'name']);
      const withCreator = options.includeCreator
        ? options.joinType === 'INNER'
          ? base.innerJoin('users', 'created_by', 'users.id', 'creator')
          : base.leftJoin('users', 'created_by', 'users.id', 'creator')
        : base;
      return options.includeUpdater
        ? withCreator.leftJoin('users', 'updated_by', 'users.id', 'updater')
        : withCreator;
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
      const base = db.table('test_table').select(['id', 'name']);
      return includeCreator
        ? base.leftJoin('users', 'created_by', 'users.id')
        : base;
    }

    const query = buildTypedQuery(true);
    const sql = query.toSQL();
    expect(sql).toContain('LEFT JOIN users ON created_by = users.id');
  });
}); 
