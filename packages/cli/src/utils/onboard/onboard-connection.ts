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
  if (username.includes(':')) {
    throw new CliError('INVALID_INPUT', 'CLICKHOUSE_USERNAME contains ":", which HTTP basic authentication cannot send (RFC 7617).', {
      hint: 'Connect as a ClickHouse user whose name has no colon.',
    });
  }
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

/** Hosts whose traffic stays on this machine. */
function loopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * A warning when the connection sends basic-auth credentials in cleartext:
 * plain `http://` to a host that is not loopback. Not refused, since a
 * private network or an SSH tunnel may make it acceptable.
 */
export function cleartextCredentialsWarning(host: string): string | undefined {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' || loopbackHost(url.hostname)) return undefined;
  return `CLICKHOUSE_URL uses http:// to ${url.hostname}, so the ClickHouse user name and password travel unencrypted. `
    + 'Use https:// (ClickHouse Cloud and most hosted services serve HTTPS on port 8443), or an SSH tunnel to localhost.';
}
