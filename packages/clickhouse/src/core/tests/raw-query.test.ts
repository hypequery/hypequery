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

describe('raw stream helpers', () => {
  it('rawStream delegates to the adapter stream', async () => {
    const rows = new ReadableStream<{ id: number }[]>();
    const streamMock = vi.fn().mockResolvedValue(rows);
    const db = createQueryBuilder<TestSchema>({ adapter: { ...testAdapter, stream: streamMock } });

    await expect(db.rawStream('SELECT id FROM users WHERE id = ?', [1], { queryId: 'q' })).resolves.toBe(rows);
    expect(streamMock).toHaveBeenCalledWith('SELECT id FROM users WHERE id = ?', [1], { queryId: 'q' });
  });

  it('rawArrowStream delegates to the adapter Arrow stream', async () => {
    const bytes = new ReadableStream<Uint8Array>();
    const streamArrowMock = vi.fn().mockResolvedValue(bytes);
    const db = createQueryBuilder<TestSchema>({ adapter: { ...testAdapter, streamArrow: streamArrowMock } });

    await expect(db.rawArrowStream('SELECT id FROM users')).resolves.toBe(bytes);
    expect(streamArrowMock).toHaveBeenCalledWith('SELECT id FROM users', [], undefined);
  });

  it('names the adapter when it cannot stream', async () => {
    const db = createQueryBuilder<TestSchema>({ adapter: testAdapter });

    await expect(db.rawStream('SELECT 1')).rejects.toThrow('Streaming is not supported by adapter "test".');
    await expect(db.rawArrowStream('SELECT 1')).rejects.toThrow('Arrow streaming is not supported by adapter "test".');
  });
});
