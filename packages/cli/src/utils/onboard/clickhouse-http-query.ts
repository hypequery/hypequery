import { readCapped } from '../read-capped.js';
import type {
  ClickHouseConnectionErrorClass,
  ClickHouseConnectionInput,
  ClickHouseQuery,
  ClickHouseQueryOptions,
} from './engine-types.js';

/** ClickHouse's codes for a user it won't serve: denied, unknown, or bad credentials. */
const ACCESS_CODES = new Set([192, 194, 497, 516]);
const MAX_MESSAGE_CHARS = 300;

/** ClickHouse's own message: the first line, without the `Code: N. DB::Exception:` prefix or version. */
export function clickHouseMessage(body: string): string {
  const line = body.trim().split('\n')[0] ?? '';
  const text = line
    .replace(/^Code:\s*\d+\.\s*/, '')
    .replace(/^DB::Exception:\s*/, '')
    .replace(/\s*\(version [^()]*(?:\([^()]*\))?\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;
}

function networkMessage(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not resolve the ClickHouse host. Check CLICKHOUSE_URL.';
  if (code === 'ECONNREFUSED') return 'Connection to ClickHouse was refused. Check CLICKHOUSE_URL and that the server is running.';
  return 'Could not connect to ClickHouse. Check CLICKHOUSE_URL and network access.';
}

/**
 * The engine's injected query function over ClickHouse's HTTP interface, for
 * the CLI: the connection is the user's own (local or remote), so unlike
 * Cloud's transport it may reach private addresses. Failures are thrown as the
 * engine's own `ClickHouseConnectionError`, which the engine checks with
 * `instanceof`. Settings and parameters go in the URL; the SQL is the body.
 */
export function createClickHouseHttpQuery(
  ClickHouseConnectionError: ClickHouseConnectionErrorClass,
  fetchImpl: typeof fetch = fetch,
): ClickHouseQuery {
  return async (input: ClickHouseConnectionInput, sql: string, options: ClickHouseQueryOptions) => {
    let url: URL;
    try {
      url = new URL(input.host);
    } catch {
      throw new ClickHouseConnectionError('CLICKHOUSE_URL is not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ClickHouseConnectionError('CLICKHOUSE_URL must use http or https.');
    }
    if (input.database) url.searchParams.set('database', input.database);
    for (const [name, value] of Object.entries(options.settings ?? {})) url.searchParams.set(name, String(value));
    for (const [name, value] of Object.entries(options.params ?? {})) url.searchParams.set(`param_${name}`, value);

    const remaining = options.deadlineMs === undefined ? options.timeoutMs : Math.min(options.timeoutMs, options.deadlineMs - Date.now());
    if (remaining <= 0) throw new ClickHouseConnectionError('ClickHouse query exceeded its time budget.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'text/tab-separated-values',
          Authorization: `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: sql,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new ClickHouseConnectionError(controller.signal.aborted
        ? 'ClickHouse query exceeded its time budget.'
        : networkMessage(error));
    }

    let body: string;
    try {
      body = new TextDecoder().decode(await readCapped(response, options.maxBytes));
    } catch (error) {
      throw new ClickHouseConnectionError(controller.signal.aborted
        ? 'ClickHouse query exceeded its time budget.'
        : /^The response exceeds/.test(error instanceof Error ? error.message : '')
          ? 'ClickHouse returned an unexpectedly large response.'
          : networkMessage(error));
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return body;
    const code = Number(response.headers.get('x-clickhouse-exception-code'));
    if (Number.isSafeInteger(code) && code > 0) {
      throw new ClickHouseConnectionError(
        clickHouseMessage(body) || `ClickHouse error ${code}.`,
        code,
        ACCESS_CODES.has(code) || response.status === 401 || response.status === 403 ? 'access' : 'query',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ClickHouseConnectionError('Authentication failed. Check CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD.', undefined, 'access');
    }
    throw new ClickHouseConnectionError(`ClickHouse returned HTTP ${response.status}. Check CLICKHOUSE_URL.`);
  };
}
