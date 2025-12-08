import type { ClickHouseClientConfig, ClickHouseConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';

const fakeClient = {} as ClickHouseClientConfig['client'];

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
});
