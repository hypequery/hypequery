import { setupTestClient } from './test-utils.js';

const DESCENDANTS = {
  sql: `
    SELECT {rootId:UInt32} AS id
    UNION ALL
    SELECT link.child_id AS id
    FROM asset_link AS link
    INNER JOIN descendants AS walked ON link.parent_id = walked.id
    WHERE link.created_by = {ownerId:UInt32}
  `,
  parameters: { rootId: 7, ownerId: 42 },
};

const FLAT_DESCENDANTS =
  "SELECT CAST(?, 'UInt32') AS id UNION ALL SELECT link.child_id AS id FROM asset_link AS link " +
  "INNER JOIN descendants AS walked ON link.parent_id = walked.id " +
  "WHERE link.created_by = CAST(?, 'UInt32')";

describe('CTE scopes', () => {
  let db: ReturnType<typeof setupTestClient>;

  beforeEach(() => {
    db = setupTestClient();
  });

  it('reads from a recursive CTE declared before the source', () => {
    const { sql, parameters } = db
      .withRecursiveCTE('descendants', DESCENDANTS, { id: 'UInt32' })
      .table('descendants')
      .select(['id'])
      .distinct()
      .toSQLWithParams();

    expect(sql.replace(/\s+/g, ' ')).toBe(
      `WITH RECURSIVE descendants AS (${FLAT_DESCENDANTS}) SELECT DISTINCT id FROM descendants`
    );
    expect(parameters).toEqual([7, 42]);
  });

  it('reads from a schema table while carrying the declared CTEs', () => {
    const sql = db
      .withRecursiveCTE('descendants', 'SELECT 1 AS id UNION ALL SELECT id FROM descendants', {
        id: 'Int32',
      })
      .table('test_table')
      .innerJoin('descendants', 'id', 'descendants.id')
      .select(['test_table.name'])
      .toSQL();

    expect(sql).toBe(
      'WITH RECURSIVE descendants AS (SELECT 1 AS id UNION ALL SELECT id FROM descendants) ' +
      'SELECT test_table.name FROM test_table ' +
      'INNER JOIN descendants ON id = descendants.id'
    );
  });

  it('declares several CTEs in order and keeps them all on the query', () => {
    const sql = db
      .withCTE('roots', 'SELECT id FROM test_table WHERE created_by = 1', { id: 'Int32' })
      .withRecursiveCTE('descendants', 'SELECT id FROM roots UNION ALL SELECT id FROM descendants', {
        id: 'Int32',
      })
      .table('descendants')
      .select(['id'])
      .toSQL();

    expect(sql).toBe(
      'WITH RECURSIVE roots AS (SELECT id FROM test_table WHERE created_by = 1), ' +
      'descendants AS (SELECT id FROM roots UNION ALL SELECT id FROM descendants) ' +
      'SELECT id FROM descendants'
    );
  });

  it('takes a builder as a CTE body and reads from it', () => {
    const activeUsers = db
      .table('users')
      .select(['id', 'user_name'])
      .where('user_name', 'eq', 'Ada');

    const { sql, parameters } = db
      .withCTE('active_users', activeUsers)
      .table('active_users')
      .select(['user_name'])
      .toSQLWithParams();

    expect(sql).toBe(
      'WITH active_users AS (SELECT id, user_name FROM users WHERE user_name = ?) ' +
      'SELECT user_name FROM active_users'
    );
    expect(parameters).toEqual(['Ada']);
  });

  it('leaves the clause non-recursive when nothing is declared recursive', () => {
    const sql = db
      .withCTE('roots', 'SELECT id FROM test_table', { id: 'Int32' })
      .table('roots')
      .select(['id'])
      .toSQL();

    expect(sql).toBe('WITH roots AS (SELECT id FROM test_table) SELECT id FROM roots');
  });

  it('does not leak declarations between queries started from the same scope', () => {
    const scope = db.withCTE('roots', 'SELECT id FROM test_table', { id: 'Int32' });
    const withExtra = scope.withCTE('extra', 'SELECT id FROM users', { id: 'Int32' });

    expect(scope.table('roots').select(['id']).toSQL()).toBe(
      'WITH roots AS (SELECT id FROM test_table) SELECT id FROM roots'
    );
    expect(withExtra.table('roots').select(['id']).toSQL()).toBe(
      'WITH roots AS (SELECT id FROM test_table), extra AS (SELECT id FROM users) ' +
      'SELECT id FROM roots'
    );
  });

  it('rejects table-only modifiers on a CTE source', () => {
    const query = db
      .withCTE('roots', 'SELECT id FROM test_table', { id: 'Int32' })
      .table('roots');

    expect(() => query.final()).toThrow(
      'FINAL can only be applied to a table source, and "roots" is a CTE.'
    );
    expect(() => query.prewhere('id', 'eq', 1)).toThrow(
      'PREWHERE can only be applied to a table source, and "roots" is a CTE.'
    );
  });
});
