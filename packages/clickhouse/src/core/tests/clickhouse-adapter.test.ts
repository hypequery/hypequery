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

    it('omits the adapter-owned quoting setting in server-default mode', async () => {
      const clientQueryMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
        integerJsonEncoding: 'server-default',
      });

      await adapter.query('SELECT 1');

      expect(clientQueryMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({});
    });

    it('supports server-default mode through createQueryBuilder', async () => {
      const clientQueryMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });
      const db = createQueryBuilder<{ events: { id: 'UInt64' } }>({
        client: { query: clientQueryMock } as any,
        integerJsonEncoding: 'server-default',
      });

      await db.rawQuery('SELECT id FROM events');

      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({});
    });

    it('preserves explicit settings in server-default mode', async () => {
      const clientQueryMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
        integerJsonEncoding: 'server-default',
        clickhouse_settings: { max_execution_time: 30 },
      });

      await adapter.query('SELECT 1', [], {
        clickhouseSettings: { final: 1 },
      });

      expect(clientQueryMock.mock.calls[0][0].clickhouse_settings).toEqual({
        max_execution_time: 30,
        final: 1,
      });
    });

    it('returns actionable guidance instead of retrying the adapter setting', async () => {
      const cause = readonlyError();
      const clientQueryMock = vi.fn().mockRejectedValue(cause);

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      let error: unknown;
      try {
        await adapter.query('SELECT 1');
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("integerJsonEncoding: 'server-default'");
      expect((error as Error).cause).toBe(cause);
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
    });

    it('preserves readonly errors caused by another setting', async () => {
      const error = Object.assign(
        new Error("Cannot modify 'max_execution_time' setting in readonly mode."),
        { code: '164', type: 'READONLY' },
      );
      const clientQueryMock = vi.fn().mockRejectedValue(error);

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      await expect(adapter.query('SELECT 1')).rejects.toBe(error);
      expect(clientQueryMock).toHaveBeenCalledTimes(1);
    });

    it('preserves errors for a caller-owned quoting setting', async () => {
      const error = readonlyError();
      const clientQueryMock = vi.fn().mockRejectedValue(error);

      const adapter = new ClickHouseAdapter({
        client: { query: clientQueryMock } as any,
      });

      await expect(adapter.query('SELECT 1', [], {
        clickhouseSettings: { [QUOTE_64BIT]: 0 },
      })).rejects.toBe(error);
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

      // Explicit config wins because the adapter default has lower precedence.
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

describe('ClickHouseAdapter.streamArrow', () => {
  const EOS = Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
  const arrowBody = (data = 'arrow-bytes') => Buffer.concat([Buffer.from(data), EOS]);
  const exec = (headers: Record<string, string> = {}, body: string | Buffer = arrowBody()) =>
    vi.fn().mockResolvedValue({ stream: Readable.from([Buffer.from(body)]), response_headers: headers });
  const readAll = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Buffer[] = [];
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { bytes: Buffer.concat(chunks) };
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      return { bytes: Buffer.concat(chunks), error: error as Error };
    }
  };
  const readonlyCompressionError = () => Object.assign(
    new Error("Code: 164. DB::Exception: Cannot modify 'output_format_arrow_compression_method' setting in readonly mode. (READONLY)"),
    { code: '164', type: 'READONLY' },
  );

  it('requests ArrowStream with a FORMAT clause, dropping a trailing semicolon and comment', async () => {
    const execMock = exec();
    const adapter = new ClickHouseAdapter({ client: { exec: execMock } as any });

    const { bytes, error } = await readAll(await adapter.streamArrow('SELECT ? AS x; -- export', [1], { queryId: 'arrow-1' }));

    expect(error).toBeUndefined();
    expect(bytes.equals(arrowBody())).toBe(true);
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({
      query: 'SELECT 1 AS x\nFORMAT ArrowStream',
      clickhouse_settings: { output_format_arrow_compression_method: 'none' },
      query_id: 'arrow-1',
    }));
  });

  it('never sends default_format, which readonly = 1 users may not change', async () => {
    const execMock = exec();
    const adapter = new ClickHouseAdapter({ client: { exec: execMock } as any, arrowCompression: 'server-default' });

    await adapter.streamArrow('SELECT 1');

    expect(execMock.mock.calls[0]![0].clickhouse_settings).toEqual({});
    expect(execMock.mock.calls[0]![0].query).toBe('SELECT 1\nFORMAT ArrowStream');
  });

  it('applies connection-level settings to a caller-supplied client', async () => {
    const execMock = exec();
    const adapter = new ClickHouseAdapter({
      client: { exec: execMock } as any,
      clickhouse_settings: { final: 1, max_threads: 2 },
    });
    await adapter.streamArrow('SELECT 1', [], { clickhouseSettings: { max_threads: 4 } });

    expect(execMock.mock.calls[0]![0].clickhouse_settings).toEqual({
      output_format_arrow_compression_method: 'none', final: 1, max_threads: 4,
    });
  });

  it('lets connection-level and per-call compression outrank the default', async () => {
    const execMock = exec();
    const configured = new ClickHouseAdapter({
      client: { exec: execMock } as any,
      clickhouse_settings: { output_format_arrow_compression_method: 'lz4_frame' },
    });
    await configured.streamArrow('SELECT 1');
    expect(execMock.mock.calls[0]![0].clickhouse_settings)
      .toEqual({ output_format_arrow_compression_method: 'lz4_frame' });

    const perCall = new ClickHouseAdapter({ client: { exec: execMock } as any, arrowCompression: 'server-default' });
    await perCall.streamArrow('SELECT 1', [], { clickhouseSettings: { output_format_arrow_compression_method: 'zstd' } });
    expect(execMock.mock.calls[1]![0].clickhouse_settings)
      .toEqual({ output_format_arrow_compression_method: 'zstd' });
  });

  it('explains a readonly = 1 rejection of the compression default, keeping the cause', async () => {
    const cause = readonlyCompressionError();
    const execMock = vi.fn().mockRejectedValue(cause);
    const adapter = new ClickHouseAdapter({ client: { exec: execMock } as any });

    const error = await adapter.streamArrow('SELECT 1').catch((caught: unknown) => caught as Error);

    expect(error.message).toContain("arrowCompression: 'server-default'");
    expect(error.message).toContain('settings profile');
    expect(error.cause).toBe(cause);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error when the rejected compression setting is the caller\'s', async () => {
    const cause = readonlyCompressionError();
    const adapter = new ClickHouseAdapter({ client: { exec: vi.fn().mockRejectedValue(cause) } as any });

    await expect(adapter.streamArrow('SELECT 1', [], {
      clickhouseSettings: { output_format_arrow_compression_method: 'none' },
    })).rejects.toBe(cause);
  });

  it('refuses a statement that already asks for another format', async () => {
    const execMock = exec();
    const adapter = new ClickHouseAdapter({ client: { exec: execMock } as any });

    await expect(adapter.streamArrow('SELECT 1 FORMAT JSONEachRow')).rejects.toThrow('Leave out the FORMAT clause');
    expect(execMock).not.toHaveBeenCalled();

    await adapter.streamArrow('SELECT 1 format ArrowStream;');
    expect(execMock.mock.calls[0]![0].query).toBe('SELECT 1 format ArrowStream');
  });

  it("fails the stream with ClickHouse's error when the response carries an exception block", async () => {
    const tag = 'abcdefghijklmnop';
    const message = 'Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)';
    const body = `data\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`;
    const adapter = new ClickHouseAdapter({
      client: { exec: exec({ 'x-clickhouse-exception-tag': tag }, body) } as any,
    });

    const reader = (await adapter.streamArrow('SELECT 1')).getReader();

    expect(Buffer.from((await reader.read()).value!).toString()).toBe('data');
    await expect(reader.read()).rejects.toThrow('boom');
  });

  it("recovers ClickHouse's error from an untagged failure on servers before 25.11", async () => {
    const message = 'Code: 395. DB::Exception: boom mid-stream: while executing. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 24.8.1.1)\n';
    const adapter = new ClickHouseAdapter({ client: { exec: exec({}, `partial${message}`) } as any });

    const { bytes, error } = await readAll(await adapter.streamArrow('SELECT 1'));

    expect(bytes.toString()).toBe('partial');
    expect(error?.message).toContain('boom mid-stream');
    expect(error).toMatchObject({ code: '395', type: 'FUNCTION_THROW_IF_VALUE_IS_NON_ZERO' });
  });

  it('fails a body that ends without the end-of-stream marker', async () => {
    const adapter = new ClickHouseAdapter({ client: { exec: exec({}, 'truncated') } as any });

    const { bytes, error } = await readAll(await adapter.streamArrow('SELECT 1'));

    expect(bytes.toString()).toBe('truncated');
    expect(error?.message).toContain('result is incomplete');
  });

  it('rejects a pre-aborted stream without calling the client', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller went away'));
    const execMock = vi.fn();
    const adapter = new ClickHouseAdapter({ client: { exec: execMock } as any });

    await expect(adapter.streamArrow('SELECT 1', [], { abortSignal: controller.signal }))
      .rejects.toThrow('caller went away');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('streams through the builder with its settings', async () => {
    const execMock = exec();
    const db = createQueryBuilder<{ events: { id: 'UInt32' } }>({ client: { exec: execMock } as any });

    await db.table('events').select(['id']).settings({ max_threads: 2 }).streamArrow();

    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringMatching(/FROM events\nFORMAT ArrowStream$/),
      clickhouse_settings: { output_format_arrow_compression_method: 'none', max_threads: 2 },
    }));
  });
});

describe('JSONEachRow byte streams', () => {
  const rowsFrom = async (chunks: Buffer[]) => {
    const adapter = new ClickHouseAdapter({
      client: { query: vi.fn().mockResolvedValue({ stream: () => Readable.from(chunks) }) } as any,
    });
    const rows: unknown[] = [];
    for await (const batch of (await adapter.stream('SELECT 1')) as unknown as AsyncIterable<unknown[]>) rows.push(...batch);
    return rows;
  };

  it('completes a row split across chunks', async () => {
    expect(await rowsFrom([Buffer.from('{"id":'), Buffer.from('1}\n{"id":2}\n')])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('keeps a final row without a trailing newline', async () => {
    expect(await rowsFrom([Buffer.from('{"id":1}\n{"id":2}')])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('keeps a character split across chunks', async () => {
    const bytes = Buffer.from('{"name":"café"}\n');
    const at = bytes.indexOf(0xc3) + 1;
    expect(await rowsFrom([bytes.subarray(0, at), bytes.subarray(at)])).toEqual([{ name: 'café' }]);
  });
});
