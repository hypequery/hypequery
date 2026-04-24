import { describe, it, expect, vi } from 'vitest';
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
      clickhouse_settings: { final: 1, max_execution_time: 10 },
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
      clickhouse_settings: { final: 1, max_execution_time: 10 },
      query_id: 'query-456',
    });
  });
});
