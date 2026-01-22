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
    const result = await db.rawQuery(
      'SELECT * FROM users WHERE id = :id AND status = :status',
      { id: 42, status: 'active' }
    );

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledWith({
      query: "SELECT * FROM users WHERE id = 42 AND status = 'active'",
      format: 'JSONEachRow',
    });
  });

  it('replaces repeated parameters consistently', async () => {
    queryMock.mockResolvedValue({ json: vi.fn().mockResolvedValue([]) });
    const db = createQueryBuilder<TestSchema>(baseConfig);

    await db.rawQuery('SELECT :value + :value AS doubled', { value: 10 });

    expect(queryMock).toHaveBeenCalledWith({
      query: 'SELECT 10 + 10 AS doubled',
      format: 'JSONEachRow',
    });
  });

  it('throws when a named parameter is missing', async () => {
    const db = createQueryBuilder<TestSchema>(baseConfig);

    await expect(
      db.rawQuery('SELECT * FROM users WHERE id = :id AND status = :status', { id: 1 })
    ).rejects.toThrow('Missing value for parameter :status');

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('throws when unused parameters are provided', async () => {
    const db = createQueryBuilder<TestSchema>(baseConfig);

    await expect(
      db.rawQuery('SELECT * FROM users WHERE id = :id', { id: 1, extra: 'nope' })
    ).rejects.toThrow('Unused parameter(s): extra');

    expect(queryMock).not.toHaveBeenCalled();
  });
});
