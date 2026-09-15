import { escapeValue } from '../utils.js';

/**
 * ClickHouse's Array text format uses SQL literals, not JSON's double-quoted
 * strings. Keep the serialized array as a bound string for the outer CAST;
 * the normal adapter rendering path will escape that string once more.
 */
export function serializeArrayParameter(values: readonly unknown[]): string {
  return `[${values.map(value => Array.isArray(value)
    ? serializeArrayParameter(value)
    : escapeValue(value)).join(',')}]`;
}
