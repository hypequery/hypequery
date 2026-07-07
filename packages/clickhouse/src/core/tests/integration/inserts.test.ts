import { ClickHouseConnection } from '../../connection.js';
import { ensureConnectionInitialized, TEST_CONNECTION_CONFIG } from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';
import { createQueryBuilder } from '../../../index.js';

interface InsertTestSchema {
  insert_test: {
    id: 'Int32';
    name: 'String';
    amount: 'Float64';
    big: 'Int64';
    happened_at: 'DateTime64(3)';
    day: 'Date';
    tags: 'Array(String)';
    attributes: 'Map(String, String)';
    note: 'Nullable(String)';
    status: 'String';
  };
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS insert_test (
    id Int32,
    name String,
    amount Float64,
    big Int64,
    happened_at DateTime64(3),
    day Date,
    tags Array(String),
    attributes Map(String, String),
    note Nullable(String),
    status String DEFAULT 'pending'
  ) ENGINE = MergeTree()
  ORDER BY id
`;

describe('Integration Tests - Inserts', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: ReturnType<typeof createQueryBuilder<InsertTestSchema>>;

    beforeAll(async () => {
      ensureConnectionInitialized();
      const client = ClickHouseConnection.getClient();
      await client.command({ query: 'DROP TABLE IF EXISTS insert_test' });
      await client.command({ query: CREATE_TABLE_SQL });

      db = createQueryBuilder<InsertTestSchema>({
        host: TEST_CONNECTION_CONFIG.host,
        username: TEST_CONNECTION_CONFIG.user,
        password: TEST_CONNECTION_CONFIG.password,
        database: TEST_CONNECTION_CONFIG.database,
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      const client = ClickHouseConnection.getClient();
      await client.command({ query: 'DROP TABLE IF EXISTS insert_test' });
    });

    test('inserts a full-width row and reads back the same values', async () => {
      const happenedAt = new Date('2026-03-04T05:06:07.890Z');

      const result = await db.insert('insert_test').values({
        id: 1,
        name: 'full-row',
        amount: 12.5,
        big: 9007199254740993n,
        happened_at: happenedAt,
        day: '2026-03-04',   // Date columns take 'YYYY-MM-DD' strings; JSONEachRow rejects datetime strings
        tags: ['a', 'b'],
        attributes: { source: 'integration' },
        note: null,
        status: 'explicit',
      }).execute();

      expect(result.executed).toBe(true);
      expect(result.queryId).not.toBe('');
      expect(Number(result.summary?.written_rows)).toBe(1);

      const [row] = await db.table('insert_test').select('*').where('id', 'eq', 1).execute();
      expect(row.name).toBe('full-row');
      expect(row.amount).toBe(12.5);
      expect(row.big).toBe('9007199254740993');
      expect(row.day).toBe('2026-03-04');
      expect(row.tags).toEqual(['a', 'b']);
      expect(row.attributes).toEqual({ source: 'integration' });
      expect(row.note).toBeNull();
      expect(row.status).toBe('explicit');
      // DateTime64(3) round trip: server returns 'YYYY-MM-DD HH:MM:SS.mmm' in the
      // server timezone (UTC in the test container).
      expect(new Date(`${row.happened_at.replace(' ', 'T')}Z`).getTime()).toBe(happenedAt.getTime());
    });

    test('columns() subset lets ClickHouse fill DEFAULT and Nullable columns', async () => {
      const result = await db.insert('insert_test')
        .columns(['id', 'name', 'amount', 'big', 'happened_at', 'day', 'tags', 'attributes'])
        .values([
          {
            id: 2,
            name: 'defaulted',
            amount: 1,
            big: 2,
            happened_at: '2026-03-05 00:00:00.000',
            day: '2026-03-05',
            tags: [],
            attributes: {},
          },
        ])
        .execute();

      expect(result.executed).toBe(true);

      const [row] = await db.table('insert_test').select('*').where('id', 'eq', 2).execute();
      expect(row.status).toBe('pending');   // filled by column DEFAULT
      expect(row.note).toBeNull();          // Nullable defaults to NULL
    });

    test('inserts multiple rows in one request', async () => {
      const base = {
        amount: 0,
        big: 0,
        happened_at: '2026-03-06 00:00:00.000',
        day: '2026-03-06',
        tags: [],
        attributes: {},
        status: 'batch',
      };
      await db.insert('insert_test').values([
        { ...base, id: 10, name: 'batch-1' },
        { ...base, id: 11, name: 'batch-2' },
        { ...base, id: 12, name: 'batch-3' },
      ]).execute();

      const rows = await db.table('insert_test')
        .select(['id', 'name'])
        .where('status', 'eq', 'batch')
        .orderBy('id', 'ASC')
        .execute();
      expect(rows.map(row => row.name)).toEqual(['batch-1', 'batch-2', 'batch-3']);
    });

    test('an explicit empty batch is a no-op', async () => {
      const result = await db.insert('insert_test').values([]).execute();
      expect(result).toEqual({ queryId: '', executed: false });
    });
  });
});
