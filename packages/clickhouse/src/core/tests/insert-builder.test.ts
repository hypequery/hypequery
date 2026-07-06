import { createQueryBuilder } from '../../index.js';
import { normalizeInsertRows } from '../features/insert-executor.js';
import type {
  DatabaseAdapter,
  InsertExecutionOptions,
} from '../adapters/database-adapter.js';
import type { TestSchema } from './test-utils.js';

interface CapturedInsert {
  table: string;
  rows: Record<string, unknown>[];
  options?: InsertExecutionOptions;
}

function createCapturingAdapter() {
  const calls: CapturedInsert[] = [];
  const adapter: DatabaseAdapter = {
    name: 'capture',
    query: async () => {
      throw new Error('Capture adapter does not execute queries.');
    },
    insert: async (table, rows, options) => {
      calls.push({ table, rows, options });
      return { queryId: 'test-query-id', executed: true };
    },
  };
  return { adapter, calls };
}

function createDb() {
  const { adapter, calls } = createCapturingAdapter();
  return { db: createQueryBuilder<TestSchema>({ adapter }), calls };
}

const userRow = {
  id: 1,
  user_name: 'ada',
  email: 'ada@example.com',
  created_at: '2026-01-01',
  profile: { plan: 'pro' },
  roles: ['admin'],
  is_active: true,
};

describe('InsertBuilder', () => {
  it('inserts a single row through the adapter', async () => {
    const { db, calls } = createDb();
    const result = await db.insert('users').values(userRow).execute();

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('users');
    expect(calls[0].rows).toEqual([userRow]);
    expect(result).toEqual({ queryId: 'test-query-id', executed: true });
  });

  it('accepts arrays and accumulates chained values calls', async () => {
    const { db, calls } = createDb();
    await db
      .insert('users')
      .values([userRow, { ...userRow, id: 2 }])
      .values({ ...userRow, id: 3 })
      .execute();

    expect(calls[0].rows.map(row => row.id)).toEqual([1, 2, 3]);
  });

  it('normalizes Date and bigint values before they reach the adapter', async () => {
    const { db, calls } = createDb();
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    await db.insert('users').values({ ...userRow, created_at: createdAt }).execute();

    expect(calls[0].rows[0].created_at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('forwards the column subset, settings, and queryId', async () => {
    const { db, calls } = createDb();
    await db
      .insert('users')
      .columns(['id', 'user_name'])
      .values({ id: 1, user_name: 'ada' })
      .settings({ async_insert: 1 })
      .execute({ queryId: 'custom-id' });

    expect(calls[0].options).toEqual({
      clickhouseSettings: { async_insert: 1 },
      queryId: 'custom-id',
      columns: ['id', 'user_name'],
    });
  });

  it('throws when executed without values', async () => {
    const { db } = createDb();
    await expect(db.insert('users').execute()).rejects.toThrow(
      'No values provided. Call .values() before .execute().'
    );
  });

  it('throws when columns() is called after values()', () => {
    const { db } = createDb();
    const withValues = db.insert('users').values(userRow);
    expect(() => withValues.columns(['id'])).toThrow('Call .columns() before .values().');
  });

  it('throws a clear error when the adapter does not support inserts', async () => {
    const adapter: DatabaseAdapter = {
      name: 'read-only',
      query: async () => [],
    };
    const db = createQueryBuilder<TestSchema>({ adapter });
    await expect(db.insert('users').values(userRow).execute()).rejects.toThrow(
      'Inserts are not supported by adapter "read-only". Implement DatabaseAdapter.insert to enable them.'
    );
  });

  it('is immutable: deriving builders does not mutate the base', async () => {
    const { db, calls } = createDb();
    const base = db.insert('users');
    const first = base.values(userRow);
    first.values({ ...userRow, id: 2 }).settings({ async_insert: 1 });

    await first.execute();
    expect(calls[0].rows).toHaveLength(1);
    expect(calls[0].options?.clickhouseSettings).toBeUndefined();
    await expect(base.execute()).rejects.toThrow('No values provided');
  });

  it('propagates adapter errors', async () => {
    const adapter: DatabaseAdapter = {
      name: 'failing',
      query: async () => [],
      insert: async () => {
        throw new Error('insert failed');
      },
    };
    const db = createQueryBuilder<TestSchema>({ adapter });
    await expect(db.insert('users').values(userRow).execute()).rejects.toThrow('insert failed');
  });
});

describe('normalizeInsertRows', () => {
  it('converts Date values to ISO strings and bigint to decimal strings', () => {
    const [row] = normalizeInsertRows([
      { at: new Date('2026-01-02T03:04:05.000Z'), big: 9007199254740993n },
    ]);
    expect(row).toEqual({ at: '2026-01-02T03:04:05.000Z', big: '9007199254740993' });
  });

  it('recurses through arrays and plain objects', () => {
    const [row] = normalizeInsertRows([
      {
        timestamps: [new Date('2026-01-01T00:00:00.000Z')],
        map: { seen_at: new Date('2026-01-01T00:00:00.000Z'), ids: [1n] },
      },
    ]);
    expect(row).toEqual({
      timestamps: ['2026-01-01T00:00:00.000Z'],
      map: { seen_at: '2026-01-01T00:00:00.000Z', ids: ['1'] },
    });
  });

  it('leaves primitives, null, and non-plain objects untouched', () => {
    class Custom { value = 1; }
    const custom = new Custom();
    const [row] = normalizeInsertRows([
      { n: 1.5, s: 'text', b: true, empty: null, custom },
    ]);
    expect(row).toEqual({ n: 1.5, s: 'text', b: true, empty: null, custom });
    expect(row.custom).toBe(custom);
  });
});
