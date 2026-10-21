import { parseTimeBound } from './time-axis-bounds.js';

/**
 * True for the timestamp text a filter may bind: a real calendar date, or a
 * date and time with seconds, optionally with a fraction and `Z`/offset.
 *
 * ClickHouse reads an invalid `DateTime64` parameter as some other instant
 * instead of refusing it (`2026-13-45` becomes 1900-01-01, `2026-02-30`
 * rolls into March, digits are read as Unix seconds), and refuses a time
 * without seconds, so anything else is rejected before planning. This is
 * the same rule as the Python planner's.
 */
export function isTimestampText(value: unknown): value is string {
  const parsed = parseTimeBound(value);
  if (!parsed) return false;
  const time = parsed.text.slice(10);
  return time === '' || /^[T ]\d{2}:\d{2}:\d{2}/.test(time);
}
