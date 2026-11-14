import { createHash } from 'node:crypto';
import { CliError } from '../cli-error.js';
import { getClickHouseConfigFromEnv } from '../clickhouse-client.js';
import type { ClickHouseConnectionInput } from './engine-types.js';

/** Databases one connection may discover from; the engine's own cap (decision 0018). */
const MAX_DATABASES = 20;

/**
 * The engine's connection input from the same `CLICKHOUSE_*` settings
 * `generate:datasets` reads. Credentials written into the URL
 * (`http://user:pass@host`) are moved out of it, since the transport sends
 * them as a header. `databases` adds databases beyond `CLICKHOUSE_DATABASE`.
 */
export function onboardConnectionFromEnv(databases?: string): ClickHouseConnectionInput {
  const config = getClickHouseConfigFromEnv();
  if (!config) {
    throw new CliError('CLICKHOUSE_NOT_CONFIGURED', 'ClickHouse connection details are missing. Set CLICKHOUSE_URL (or CLICKHOUSE_HOST), '
      + 'CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD in the environment or .env.', {
      hint: 'Set CLICKHOUSE_URL, CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD.',
    });
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(config.url) ? config.url : `http://${config.url}`);
  } catch {
    throw new CliError('INVALID_INPUT', 'CLICKHOUSE_URL is not a valid URL.', { hint: 'Set CLICKHOUSE_URL to the HTTP interface, e.g. http://localhost:8123.' });
  }
  const username = url.username && !process.env.CLICKHOUSE_USERNAME && !process.env.CLICKHOUSE_USER
    ? decodeURIComponent(url.username)
    : config.username;
  const password = url.password && !process.env.CLICKHOUSE_PASSWORD && !process.env.CLICKHOUSE_PASS
    ? decodeURIComponent(url.password)
    : config.password;
  url.username = '';
  url.password = '';
  url.hash = '';
  const extra = (databases ?? '').split(',').map(name => name.trim()).filter(Boolean);
  const all = [...new Set([config.database, ...extra])];
  if (all.length > MAX_DATABASES) {
    throw new CliError('INVALID_INPUT', `At most ${MAX_DATABASES} databases can be analysed at once; ${all.length} were given.`, {
      hint: 'Pass fewer names to --databases.',
    });
  }
  return {
    host: url.toString().replace(/\/$/, ''),
    database: config.database,
    ...(all.length > 1 ? { databases: all } : {}),
    username,
    password,
  };
}

/** Identifies a connection in the engine's reports without its password. */
export function connectionFingerprint(input: ClickHouseConnectionInput): string {
  return createHash('sha256').update(JSON.stringify([input.host, input.username, input.database])).digest('hex');
}
