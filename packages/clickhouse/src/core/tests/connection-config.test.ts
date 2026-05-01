import { expect, describe, it, vi, afterEach } from 'vitest';
import type { ClickHouseClientConfig, ClickHouseConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';

const fakeClient = {} as ClickHouseClientConfig['client'];

afterEach(() => {
  vi.resetModules();
  vi.unmock('../env/auto-client.js');
});

describe('isClientConfig', () => {
  it('treats configs with a client as client configs even if host information is present', () => {
    const config: ClickHouseConfig = {
      host: 'http://localhost:8123',
      username: 'default',
      client: fakeClient
    };

    expect(isClientConfig(config)).toBe(true);
  });

  it('returns false when no client is provided', () => {
    const config: ClickHouseConfig = {
      host: 'http://localhost:8123'
    };

    expect(isClientConfig(config)).toBe(false);
  });

  it('returns false for url-only configs without a client', () => {
    const config: ClickHouseConfig = {
      url: 'http://localhost:8123'
    };

    expect(isClientConfig(config)).toBe(false);
  });

  it('passes host-only configs through to the ClickHouse client for deprecated compatibility', async () => {
    const createClient = vi.fn().mockReturnValue(fakeClient);

    vi.doMock('../env/auto-client.js', () => ({
      getAutoClientModule: () => ({
        createClient,
        ClickHouseSettings: {},
      }),
    }));

    const { ClickHouseConnection } = await import('../connection.js');

    const config: ClickHouseConfig = {
      host: 'http://localhost:8123',
      username: 'default',
      password: 'secret',
      database: 'analytics',
    };

    ClickHouseConnection.initialize(config);

    expect(createClient).toHaveBeenCalledWith(config);
    expect(ClickHouseConnection.getClient()).toBe(fakeClient);
  });
});
