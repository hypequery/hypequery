import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { IntegerJsonEncoding } from '../query-builder.js';

const QUOTE_64BIT = 'output_format_json_quote_64bit_integers';

export interface IntegerJsonSettingsAttempt {
  settings: ClickHouseSettings;
  adapterDefaultApplied: boolean;
}

function hasQuote64BitSetting(settings?: ClickHouseSettings): boolean {
  return settings !== undefined && Object.prototype.hasOwnProperty.call(settings, QUOTE_64BIT);
}

/**
 * Applies the adapter default without overriding connection-level or per-query
 * settings, and records whether the final value belongs to the adapter.
 */
export function buildIntegerJsonSettings(
  encoding: IntegerJsonEncoding,
  configSettings?: ClickHouseSettings,
  optionSettings?: ClickHouseSettings,
): IntegerJsonSettingsAttempt {
  const adapterDefaultApplied = encoding === 'quoted'
    && !hasQuote64BitSetting(configSettings)
    && !hasQuote64BitSetting(optionSettings);

  return {
    adapterDefaultApplied,
    settings: {
      ...(adapterDefaultApplied ? { [QUOTE_64BIT]: 1 } : {}),
      ...configSettings,
      ...optionSettings,
    },
  };
}

/**
 * Returns guidance only when ClickHouse rejected the adapter-owned precision
 * setting. Code 164 can also represent caller-owned settings and forbidden
 * operations, whose original errors must be preserved.
 */
export function createReadonlyIntegerJsonError(
  error: unknown,
  adapterDefaultApplied: boolean,
): Error | undefined {
  if (!adapterDefaultApplied || !isReadonlyQuote64BitError(error)) return undefined;

  return new Error(
    `ClickHouse rejected HypeQuery's precision-safe setting (${QUOTE_64BIT}=1) ` +
    `because this connection uses readonly = 1. Set ` +
    `integerJsonEncoding: 'server-default' in the HypeQuery adapter or query-builder ` +
    `configuration to omit it. The server may then return Int64 and wider values as ` +
    `JSON numbers, which lose precision beyond 2^53.`,
    { cause: error },
  );
}

function isReadonlyQuote64BitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.includes(QUOTE_64BIT)) return false;

  return code === '164'
    || code === 164
    || type === 'READONLY'
    || /in readonly mode/i.test(message);
}
