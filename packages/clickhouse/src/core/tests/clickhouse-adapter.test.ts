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

  it('rejects a pre-aborted query without calling the client', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller went away'));
    const clientQueryMock = vi.fn();

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    await expect(adapter.query('SELECT 1', [], { abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted stream without calling the client', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller went away'));
    const clientQueryMock = vi.fn();

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    await expect(adapter.stream('SELECT 1', [], { abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted insert without calling the client', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller went away'));
    const clientInsertMock = vi.fn();

    const adapter = new ClickHouseAdapter({
      client: { insert: clientInsertMock } as any,
    });

    await expect(adapter.insert('events', [{ id: 1 }], { abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(clientInsertMock).not.toHaveBeenCalled();
  });

  it('closes the result set when the signal aborts while the body is being read', async () => {
    const controller = new AbortController();
    const closeMock = vi.fn();
    const clientQueryMock = vi.fn().mockResolvedValue({
      json: () => new Promise(() => undefined),
      close: closeMock,
    });

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    const pending = adapter.query('SELECT 1', [], { abortSignal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error('caller went away'));

    await expect(pending).rejects.toThrow('caller went away');
    expect(closeMock).toHaveBeenCalled();
  });

  it('destroys the source stream when the signal aborts mid-stream', async () => {
    const controller = new AbortController();
    const source = new Readable({ read() { /* stays open */ } });
    source.push('{"id":1}\n');
    const clientQueryMock = vi.fn().mockResolvedValue({
      stream: () => source,
    });

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    const stream = await adapter.stream<{ id: number }>('SELECT 1', [], { abortSignal: controller.signal });
    const reader = stream.getReader();
    expect(await reader.read()).toEqual({ done: false, value: [{ id: 1 }] });

    controller.abort(new Error('caller went away'));

    await expect(reader.read()).rejects.toThrow('caller went away');
    await vi.waitFor(() => expect(source.destroyed).toBe(true));
  });

  it('destroys the source stream when aborting an actively pending read', async () => {
    const controller = new AbortController();
    const source = new Readable({ read() { /* stays open */ } });
    const clientQueryMock = vi.fn().mockResolvedValue({
      stream: () => source,
    });

    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    const stream = await adapter.stream('SELECT 1', [], { abortSignal: controller.signal });
    const pendingRead = stream.getReader().read();
    await new Promise(resolve => setImmediate(resolve));

    controller.abort(new Error('caller went away'));

    await expect(pendingRead).rejects.toThrow('caller went away');
    await vi.waitFor(() => expect(source.destroyed).toBe(true));
  });

  it('destroys the source stream when parsing a chunk fails', async () => {
    const source = new Readable({ read() { /* stays open */ } });
    source.push('{not-json}\n');
    const clientQueryMock = vi.fn().mockResolvedValue({
      stream: () => source,
    });
    const adapter = new ClickHouseAdapter({
      client: { query: clientQueryMock } as any,
    });

    const stream = await adapter.stream('SELECT 1');

    await expect(stream.getReader().read()).rejects.toThrow();
    expect(source.destroyed).toBe(true);
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

  describe('readonly connections', () => {
    const QUOTE_64BIT = 'output_format_json_quote_64bit_integers';

    /** What @clickhouse/client throws under `readonly = 1`. */
    const readonlyError = () =>
      Object.assign(
        new Error(`Cannot modify '${QUOTE_64BIT}' setting in readonly mode. `),
        { code: '164', type: 'READONLY' },
      );

    it('retries without the quoting setting when the server rejects it', async () => {
      const jsonMock = vi.fn().mockResolvedValue([{ id: 1 }]);
      const clientQueryMock = vi
        .fn()
        .mockRejectedValueOnce(readonlyError())
        .mockResolvedValue({ json: jsonMock });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      const result = await adapter.query<{ id: number }>('SELECT 1');

      expect(result).toEqual([{ id: 1 }]);
      expect(clientQueryMock).toHaveBeenCalledTimes(2);
      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({
        [QUOTE_64BIT]: 1,
      });
      expect(clientQueryMock.mock.calls[1][0].clickhouse_settings).toEqual({});
    });

    it('remembers the fallback so later queries do not retry', async () => {
      const jsonMock = vi.fn().mockResolvedValue([]);
      const clientQueryMock = vi
        .fn()
        .mockRejectedValueOnce(readonlyError())
        .mockResolvedValue({ json: jsonMock });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      await adapter.query('SELECT 1');
      clientQueryMock.mockClear();
      await adapter.query('SELECT 2');

      // One call, already without the setting — a read-only connection pays the
      // extra round trip once, not on every query.
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({});
    });

    it('does not retry errors unrelated to readonly settings', async () => {
      const clientQueryMock = vi.fn().mockRejectedValue(new Error('connection refused'));

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      await expect(adapter.query('SELECT 1')).rejects.toThrow('connection refused');
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
    });

    it('lets connection-level clickhouse_settings override the adapter default', async () => {
      const jsonMock = vi.fn().mockResolvedValue([]);
      const clientQueryMock = vi.fn().mockResolvedValue({ json: jsonMock });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
        clickhouse_settings: { [QUOTE_64BIT]: 0, max_execution_time: 30 },
      });

      await adapter.query('SELECT 1');

      // Explicit config wins, and no retry is attempted because we never sent
      // a value the caller did not ask for.
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({
        [QUOTE_64BIT]: 0,
        max_execution_time: 30,
      });
    });

    it('keeps per-query settings ahead of connection-level ones', async () => {
      const jsonMock = vi.fn().mockResolvedValue([]);
      const clientQueryMock = vi.fn().mockResolvedValue({ json: jsonMock });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
        clickhouse_settings: { max_execution_time: 30 },
      });

      await adapter.query('SELECT 1', [], {
        clickhouseSettings: { max_execution_time: 5 },
      });

      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({
        [QUOTE_64BIT]: 1,
        max_execution_time: 5,
      });
    });
  });
});
