// @ts-nocheck
import { initializeTestConnection, setupTestDatabase } from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

describe('Integration Tests - Recursive CTEs', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      if (!SKIP_INTEGRATION_TESTS) {
        db = await initializeTestConnection();
        await setupTestDatabase();
      }
    }, SETUP_TIMEOUT);

    test('executes bound arrays with quoted strings, nested nulls, and UInt64 precision', async () => {
      const names = ['foo', "O'Brien", 'a\\b', '"quoted"', "x'); SELECT 2 --"];
      const rows = await db
        .withCTE('bound_arrays', {
          sql: `SELECT {names:Array(String)} AS names,
            {nested:Array(Array(Nullable(String)))} AS nested,
            {ids:Array(UInt64)} AS ids, {empty:Array(String)} AS empty`,
          parameters: { names, nested: [names, [null], []], ids: [9007199254740993n], empty: [] },
        }, { names: 'Array(String)', nested: 'Array(Array(Nullable(String)))', ids: 'Array(UInt64)', empty: 'Array(String)' })
        .table('bound_arrays')
        .execute();

      expect(rows).toEqual([{ names, nested: [names, [null], []], ids: ['9007199254740993'], empty: [] }]);
    });

    test('binds quoted enum labels through a recursive CTE', async () => {
      const rows = await db.withRecursiveCTE('labels', {
        sql: `SELECT {label:Enum8(')' = 1, '{' = 2)} AS label, 1 AS n
          UNION ALL SELECT {next:Enum8(')' = 1, '{' = 2)}, n + 1 FROM labels WHERE n < 2`,
        parameters: { label: ')', next: '{' },
      }, { label: "Enum8(')' = 1, '{' = 2)", n: 'UInt8' })
        .table('labels').select(['label']).orderBy('n', 'ASC').execute();

      expect(rows).toEqual([{ label: ')' }, { label: '{' }]);
    });

    test('executes arrays of tuples, named tuples, and maps with nested compound values', async () => {
      const labels = ["O'Brien", 'a\\b', 'x), (2); --'];
      const parameters = {
        pairs: labels.map((label, i) => [i, label]),
        records: labels.map((label, i) => ({ label, id: i })),
        maps: labels.map(label => ({ [label]: [1, 2] })),
        nested: [new Map([[9007199254740993n, ['x', null]]])],
        empty: [],
      };
      const rows = await db.withCTE('compound', {
        sql: `SELECT {pairs:Array(Tuple(UInt32, String))} AS pairs,
          {records:Array(Tuple(id UInt32, label String))} AS records,
          {maps:Array(Map(String, Array(UInt32)))} AS maps,
          {nested:Array(Map(UInt64, Tuple(String, Nullable(UInt8))))} AS nested,
          {empty:Array(Tuple(UInt8, String))} AS empty`,
        parameters,
      }, {
        pairs: 'Array(Tuple(UInt32, String))', records: 'Array(Tuple(id UInt32, label String))',
        maps: 'Array(Map(String, Array(UInt32)))', nested: 'Array(Map(UInt64, Tuple(String, Nullable(UInt8))))',
        empty: 'Array(Tuple(UInt8, String))',
      }).table('compound').execute();

      expect(rows).toEqual([{ ...parameters, nested: [{ '9007199254740993': ['x', null] }] }]);
    });

    test('carries a bound array of tuples through a recursive term', async () => {
      const pairs = [[1, 'x']];
      const rows = await db.withRecursiveCTE('recursive_pairs', {
        sql: `SELECT {pairs:Array(Tuple(UInt32, String))} AS pairs, toUInt8(1) AS n
          UNION ALL SELECT pairs, toUInt8(n + 1) FROM recursive_pairs WHERE n < 2`,
        parameters: { pairs },
      }, { pairs: 'Array(Tuple(UInt32, String))', n: 'UInt8' })
        .table('recursive_pairs').select(['pairs', 'n']).orderBy('n', 'ASC').execute();

      expect(rows).toEqual([{ pairs, n: 1 }, { pairs, n: 2 }]);
    });

    test('walks a series declared as a recursive CTE source', async () => {
      const rows = await db
        .withRecursiveCTE(
          'counter',
          {
            sql: `
              SELECT {seed:UInt32} AS n
              UNION ALL
              SELECT n + 1 FROM counter WHERE n < {limit:UInt32}
            `,
            parameters: { seed: 1, limit: 5 },
          },
          { n: 'UInt32' },
        )
        .table('counter')
        .select(['n'])
        .orderBy('n', 'ASC')
        .execute();

      expect(rows.map(row => Number(row.n))).toEqual([1, 2, 3, 4, 5]);
    });

    test('walks UUID links while excluding another organization', async () => {
      const parameters = {
        root: '00000000-0000-0000-0000-000000000001',
        child: '00000000-0000-0000-0000-000000000002',
        grandchild: '00000000-0000-0000-0000-000000000003',
        foreign: '00000000-0000-0000-0000-000000000004',
        org: '00000000-0000-0000-0000-000000000005',
        other: '00000000-0000-0000-0000-000000000006',
      };
      const rows = await db.withCTE('links', {
        sql: `SELECT {root:UUID} AS parent_id, {child:UUID} AS child_id, {org:UUID} AS organization_id
          UNION ALL SELECT {child:UUID}, {grandchild:UUID}, {org:UUID}
          UNION ALL SELECT {root:UUID}, {foreign:UUID}, {other:UUID}`,
        parameters,
      }).withRecursiveCTE('descendants', {
        sql: `SELECT {root:UUID} AS id
          UNION ALL SELECT link.child_id FROM links AS link
          INNER JOIN descendants AS walked ON link.parent_id = walked.id
          WHERE link.organization_id = {org:UUID}`,
        parameters,
      }, { id: 'UUID' })
        .table('descendants').select(['id']).distinct().orderBy('id', 'ASC').execute();

      expect(rows).toEqual([parameters.root, parameters.child, parameters.grandchild].map(id => ({ id })));
    });

    test('keeps a bound parameter typed where the recursive term joins on it', async () => {
      // Escaping the seed as a bare string literal would make the CTE column a
      // String, and ClickHouse would refuse to join it against UInt32 ids.
      const rows = await db
        .withRecursiveCTE(
          'reachable',
          {
            sql: `
              SELECT {seed:UInt32} AS id
              UNION ALL
              SELECT users.id AS id
              FROM users
              INNER JOIN reachable AS walked ON users.id = walked.id + 1
              WHERE users.id <= {ceiling:UInt32}
            `,
            parameters: { seed: 1, ceiling: 3 },
          },
          { id: 'UInt32' },
        )
        .table('reachable')
        .select(['id'])
        .distinct()
        .orderBy('id', 'ASC')
        .execute();

      expect(rows.map(row => Number(row.id))).toEqual([1, 2, 3]);
    });

    test('accepts a plain CTE and a scalar alias in the same recursive clause', async () => {
      const rows = await db
        .table('users')
        .withCTE('seed_users', 'SELECT id FROM users WHERE id = 1', { id: 'UInt32' })
        .withRecursiveCTE(
          'walked',
          'SELECT id FROM seed_users UNION ALL SELECT id + 1 FROM walked WHERE id < 3',
          { id: 'UInt32' },
        )
        .withScalar('label', expr => expr.fn<string>('toString', expr.col('users.id')))
        .innerJoin('walked', 'id', 'walked.id')
        .select(['users.id'])
        .orderBy('users.id', 'ASC')
        .execute();

      expect(rows.map(row => Number(row.id))).toEqual([1, 2, 3]);
    });
  });
});
