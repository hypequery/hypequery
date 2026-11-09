/**
 * SQL renderings of a JavaScript `Date`, which is a UTC instant.
 *
 * A quoted ISO string (`'2026-03-01T00:00:00.000Z'`) or any string with
 * fractional seconds is rejected with TYPE_MISMATCH when ClickHouse compares it
 * with a `DateTime` sorting-key column, and a bare `'2026-03-01 00:00:00'` is
 * read in the server's time zone, not UTC. A conversion function with an
 * explicit `'UTC'` avoids both and still lets the primary index prune.
 */

// DateTime covers 1970-01-01 00:00:00 to 2106-02-07 06:28:15 UTC.
const DATETIME_MAX_MS = 4294967295 * 1000;

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error('Cannot render an invalid Date as a SQL parameter');
  }
}

/** `2026-03-01T00:00:00.123Z` → `2026-03-01 00:00:00.123` (UTC). */
function utcText(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * A ClickHouse expression for the instant. Whole seconds in the `DateTime`
 * range render as `toDateTime(..., 'UTC')`, so they also fit `IN` lists over
 * `DateTime` columns; anything else renders as `toDateTime64(..., 3, 'UTC')`.
 */
export function dateToSqlExpression(value: Date): string {
  assertValidDate(value);
  const ms = value.getTime();
  const text = utcText(value);
  if (ms % 1000 === 0 && ms >= 0 && ms <= DATETIME_MAX_MS) {
    return `toDateTime('${text.slice(0, 19)}', 'UTC')`;
  }
  return `toDateTime64('${text}', 3, 'UTC')`;
}

/**
 * The instant as a quoted ISO 8601 string, for values ClickHouse parses as
 * text (the elements of an array, tuple or map parameter read through CAST).
 */
export function dateToSqlText(value: Date): string {
  assertValidDate(value);
  return `'${value.toISOString()}'`;
}
