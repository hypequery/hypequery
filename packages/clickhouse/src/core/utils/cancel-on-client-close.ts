import type { ClickHouseSettings } from '@clickhouse/client-common';

/**
 * Aborting the HTTP request stops the client, not the query. ClickHouse keeps
 * executing a query whose client has gone unless this setting is enabled *and*
 * the request is read-only (`readonly` above 0, from the user profile or the
 * connection settings). With both, an aborted query leaves `system.processes`
 * almost immediately; with either alone it runs to completion.
 */
export const CANCEL_ON_CLIENT_CLOSE = 'cancel_http_readonly_queries_on_client_close';

function hasOwnSetting(settings: ClickHouseSettings | undefined, name: string): boolean {
  return settings !== undefined && Object.prototype.hasOwnProperty.call(settings, name);
}

/**
 * The adapter-owned cancellation default for one query, or `undefined` when it
 * does not apply: there is no signal to cancel with, the caller already chose a
 * value, or this connection has refused the setting before.
 */
export function cancelOnClientCloseDefault(options: {
  readonly abortSignal: AbortSignal | undefined;
  readonly configSettings: ClickHouseSettings | undefined;
  readonly optionSettings: ClickHouseSettings | undefined;
  readonly rejected: boolean;
}): ClickHouseSettings | undefined {
  if (!options.abortSignal || options.rejected) return undefined;
  if (hasOwnSetting(options.configSettings, CANCEL_ON_CLIENT_CLOSE)) return undefined;
  if (hasOwnSetting(options.optionSettings, CANCEL_ON_CLIENT_CLOSE)) return undefined;
  return { [CANCEL_ON_CLIENT_CLOSE]: 1 };
}

/**
 * True when ClickHouse refused the cancellation setting itself, which a
 * `readonly = 1` connection does for any setting it is sent. The query did not
 * start, so resending it without the setting is safe.
 */
export function isReadonlyCancelOnClientCloseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.includes(CANCEL_ON_CLIENT_CLOSE)) return false;

  return code === '164'
    || code === 164
    || type === 'READONLY'
    || /in readonly mode/i.test(message);
}
