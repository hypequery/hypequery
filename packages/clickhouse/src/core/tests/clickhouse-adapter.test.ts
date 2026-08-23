import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { ClickHouseAdapter } from '../adapters/clickhouse-adapter.js';
import { createQueryBuilder } from '../query-builder.js';

describe('ClickHouseAdapter', () => {
  it('uses url when deriving the adapter namespace', () => {
    const adapter = new ClickHouseAdapter({
      url: 'https://example.clickhouse.cloud:8443',
      username: 'default',
      database: 'analytics',
    });

    expect(adapter.namespace).toBe('https://example.clickhouse.cloud:8443|analytics|default');
  });

  it('forwards per-query settings and query ids to the ClickHouse client', async () => {
    const jsonMock = vi.fn().mockResolvedValue([{ id: 1 }]);
    const clientQueryMock = vi.fn().mockResolvedValue({
      json: jsonMock,
    });

    const adapter = new ClickHouseAdapter({
      client: {
        query: clientQueryMock,
      } as any,
    });

    const result = await adapter.query<{ id: number }>(
      'SELECT ?',
      [1],
      {
        clickhouseSettings: { final: 1, max_execution_time: 10 },
        queryId: 'query-123',
      },
    );

    expect(result).toEqual([{ id: 1 }]);
    expect(clientQueryMock).toHaveBeenCalledWith({
      query: 'SELECT 1',
      format: 'JSONEachRow',
      clickhouse_settings: {
        output_format_json_quote_64bit_integers: 1,
        final: 1,
        max_execution_time: 10,
      },
      query_id: 'query-123',
    });
    expect(jsonMock).toHaveBeenCalled();
  });

  it('executes builder settings through clickhouse_settings without mutating SQL text', async () => {
    const jsonMock = vi.fn().mockResolvedValue([{ id: 1 }]);
    const clientQueryMock = vi.fn().mockResolvedValue({
      json: jsonMock,
    });

    const db = createQueryBuilder<{
      events: {
        id: 'UInt32';
      };
    }>({
      adapter: new ClickHouseAdapter({
        client: {
          query: clientQueryMock,
        } as any,
      }),
    });

    const query = db
      .table('events')
      .settings({ final: 1, max_execution_time: 10 })
      .select(['id']);

    expect(query.toSQL()).toBe('SELECT id FROM events');

    await query.execute({ queryId: 'query-456' });

    expect(clientQueryMock).toHaveBeenCalledWith({
      query: 'SELECT id FROM events',
      format: 'JSONEachRow',
      clickhouse_settings: {
        output_format_json_quote_64bit_integers: 1,
        final: 1,
        max_execution_time: 10,
      },
      query_id: 'query-456',
    });
  });

  it('allows explicitly opting out of quoted 64-bit JSON integers', async () => {
    const clientQueryMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([]),
    });
    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    await adapter.query('SELECT toInt64(1)', [], {
      clickhouseSettings: { output_format_json_quote_64bit_integers: 0 },
    });

    expect(clientQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      clickhouse_settings: { output_format_json_quote_64bit_integers: 0 },
    }));
  });

  it('rejects unsafe insert identifiers before calling the client', async () => {
    const clientInsertMock = vi.fn();
    const adapter = new ClickHouseAdapter({
      client: {
        insert: clientInsertMock,
      } as any,
    });

    await expect(adapter.insert('events; DROP TABLE users', [{ id: 1 }]))
      .rejects.toThrow('Unsafe table identifier');
    expect(clientInsertMock).not.toHaveBeenCalled();
  });
});

describe('ClickHouseAdapter shutdown', () => {
  it('closes the underlying ClickHouse client', async () => {
    const clientCloseMock = vi.fn().mockResolvedValue(undefined);
    const adapter = new ClickHouseAdapter({
      client: { close: clientCloseMock } as any,
    });

    await adapter.close();

    expect(clientCloseMock).toHaveBeenCalledTimes(1);
  });

  it('closes the adapter through the query builder handle', async () => {
    const clientCloseMock = vi.fn().mockResolvedValue(undefined);
    const db = createQueryBuilder<{ events: { id: 'UInt32' } }>({
      adapter: new ClickHouseAdapter({
        client: { close: clientCloseMock } as any,
      }),
    });

    await db.close();

    expect(clientCloseMock).toHaveBeenCalledTimes(1);
  });

  it('resolves when the adapter does not implement close', async () => {
    const db = createQueryBuilder<{ events: { id: 'UInt32' } }>({
      adapter: { name: 'no-close', query: async () => [] },
    });

    await expect(db.close()).resolves.toBeUndefined();
  });
});

describe('ClickHouseAdapter abort signals', () => {
  it('forwards the abort signal to the ClickHouse client on query', async () => {
    const controller = new AbortController();
    const clientQueryMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([]),
    });

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    await adapter.query('SELECT 1', [], { abortSignal: controller.signal });

    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ abort_signal: controller.signal }),
    );
  });

  it('forwards the abort signal to the ClickHouse client on stream', async () => {
    const controller = new AbortController();
    const clientQueryMock = vi.fn().mockResolvedValue({
      stream: () => Readable.from(['{"id":1}\n']),
    });

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    await adapter.stream('SELECT 1', [], { abortSignal: controller.signal });

    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ abort_signal: controller.signal }),
    );
  });

  it('forwards the abort signal to the ClickHouse client on insert', async () => {
    const controller = new AbortController();
    const clientInsertMock = vi.fn().mockResolvedValue({
      query_id: 'insert-1',
      executed: true,
    });

    const adapter = new ClickHouseAdapter({
      client: { insert: clientInsertMock } as any,
    });

    await adapter.insert('events', [{ id: 1 }], { abortSignal: controller.signal });

    expect(clientInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ abort_signal: controller.signal }),
    );
  });

  it('rejects an aborted query through the builder', async () => {
    const controller = new AbortController();
    const clientQueryMock = vi.fn().mockImplementation(({ abort_signal }: { abort_signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        abort_signal?.addEventListener('abort', () => reject(new Error('The user aborted a request.')));
      }));

    const db = createQueryBuilder<{ events: { id: 'UInt32' } }>({
      adapter: new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      }),
    });

    const pending = db.table('events').select(['id']).execute({ abortSignal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow('The user aborted a request.');
  });
});
