import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createQueryBuilder } from '../query-builder.js';

const queryMock = vi.fn();

vi.mock('../connection', () => ({
  ClickHouseConnection: {
    initialize: vi.fn(),
    getClient: vi.fn(() => ({
      query: queryMock,
    })),
  },
}));

type TestSchema = {
  users: {
    id: 'UInt32';
  };
};

const baseConfig = {
  host: 'http://localhost:8123',
  username: 'default',
  password: 'password',
  database: 'tests',
};

describe('rawQuery helper', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('executes raw SQL with substituted parameters', async () => {
    const rows = [{ id: 1 }];
    queryMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue(rows),
    });

    const db = createQueryBuilder<TestSchema>(baseConfig);
    const result = await db.rawQuery('SELECT * FROM users WHERE id = ? AND status = ?', [42, 'active']);

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledWith({
      query: "SELECT * FROM users WHERE id = 42 AND status = 'active'",
      format: 'JSONEachRow',
    });
  });
});
