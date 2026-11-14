import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectionFingerprint, onboardConnectionFromEnv } from './onboard-connection.js';

const KEYS = ['CLICKHOUSE_URL', 'CLICKHOUSE_HOST', 'CLICKHOUSE_DATABASE', 'CLICKHOUSE_USERNAME', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD', 'CLICKHOUSE_PASS'];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('onboardConnectionFromEnv', () => {
  it('reads the CLICKHOUSE_* settings generate:datasets reads', () => {
    Object.assign(process.env, { CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_DATABASE: 'shop', CLICKHOUSE_USERNAME: 'reader', CLICKHOUSE_PASSWORD: 'pw' });
    expect(onboardConnectionFromEnv()).toEqual({ host: 'http://localhost:8123', database: 'shop', username: 'reader', password: 'pw' });
  });

  it('moves credentials out of the URL and adds --databases after the default', () => {
    Object.assign(process.env, { CLICKHOUSE_URL: 'https://u%40x:p%3Aw@ch.example.com:8443/proxy', CLICKHOUSE_DATABASE: 'shop' });
    expect(onboardConnectionFromEnv('crm, shop ,billing')).toEqual({
      host: 'https://ch.example.com:8443/proxy',
      database: 'shop',
      databases: ['shop', 'crm', 'billing'],
      username: 'u@x',
      password: 'p:w',
    });
  });

  it('fails with a fixed code when ClickHouse is not configured', () => {
    expect(() => onboardConnectionFromEnv()).toThrow(expect.objectContaining({ code: 'CLICKHOUSE_NOT_CONFIGURED' }));
  });

  it('caps the number of databases', () => {
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    const many = Array.from({ length: 21 }, (_, index) => `db${index}`).join(',');
    expect(() => onboardConnectionFromEnv(many)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('fingerprints a connection without its password', () => {
    const input = { host: 'http://h', database: 'd', username: 'u', password: 'one' };
    expect(connectionFingerprint(input)).toBe(connectionFingerprint({ ...input, password: 'two' }));
    expect(connectionFingerprint(input)).not.toBe(connectionFingerprint({ ...input, database: 'e' }));
  });
});
