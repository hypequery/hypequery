import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getClickHouseClient, resetClickHouseClientForTesting } from './clickhouse-client.js';

const close = vi.fn();
const createClient = vi.fn(() => ({ close }));

vi.mock('@clickhouse/client', () => ({
  createClient: (...args: any[]) => createClient(...args),
}));

describe('clickhouse-client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_USERNAME;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    delete process.env.CLICKHOUSE_PASS;
    delete process.env.CLICKHOUSE_DATABASE;
    createClient.mockClear();
    close.mockClear();
    resetClickHouseClientForTesting();
  });

  it('creates a client using env config', () => {
    const client = getClickHouseClient();

    expect(client).toBeDefined();
    expect(createClient).toHaveBeenCalledWith({
      url: 'http://localhost:8123',
      username: 'default',
      password: '',
      database: 'default',
    });
  });

  it('reuses the same client instance', () => {
    const first = getClickHouseClient();
    const second = getClickHouseClient();

    expect(first).toBe(second);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('throws when env config missing', () => {
    delete process.env.CLICKHOUSE_HOST;

    expect(() => getClickHouseClient()).toThrow('ClickHouse connection details are missing');
  });

  it('resets client for testing', async () => {
    getClickHouseClient();
    await resetClickHouseClientForTesting();
    expect(close).toHaveBeenCalled();
  });
});
