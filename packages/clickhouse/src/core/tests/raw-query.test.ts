import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import { createQueryBuilder } from '../query-builder.js';

const queryMock = vi.fn();

const testAdapter: DatabaseAdapter = {
  name: 'test',
  query: (sql, params = [], options) => queryMock(sql, params, options)
};

type TestSchema = {
  users: {
    id: 'UInt32';
  };
};

describe('rawQuery helper', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('executes raw SQL with substituted parameters', async () => {
    const rows = [{ id: 1 }];
    queryMock.mockResolvedValue(rows);

    const db = createQueryBuilder<TestSchema>({ adapter: testAdapter });
    const result = await db.rawQuery('SELECT * FROM users WHERE id = ? AND status = ?', [42, 'active']);

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = ? AND status = ?',
      [42, 'active'],
      undefined,
    );
  });

  it('forwards per-query execution options', async () => {
    const rows = [{ id: 1 }];
    queryMock.mockResolvedValue(rows);

    const db = createQueryBuilder<TestSchema>({ adapter: testAdapter });
    const result = await db.rawQuery(
      'SELECT * FROM users WHERE id = ?',
      [42],
      {
        clickhouseSettings: { final: 1 },
        queryId: 'raw-123',
      },
    );

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = ?',
      [42],
      {
        clickhouseSettings: { final: 1 },
        queryId: 'raw-123',
      },
    );
  });
});
