import { parseProtocolRelativeDateRange, type ProtocolRelativeDateUnit } from '@hypequery/protocol';

/**
 * Relative date ranges (RFC 0029): `today`, `last 30 days`, `this quarter`
 * and the rest of the grammar, resolved to half-open local-date bounds.
 */

/** Half-open `[start, end)` local dates, each `YYYY-MM-DD`. */
export interface ResolvedDateRange {
  readonly start: string;
  readonly end: string;
}

/** The earliest bound a range resolves to: ClickHouse stores nothing earlier. */
const EARLIEST = Date.UTC(1900, 0, 1);
const DAY_MS = 86_400_000;

/** Today's calendar date in `timezone`, as a UTC-midnight timestamp. */
function localToday(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find(entry => entry.type === type)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

/**
 * The first day of the unit containing `day`. Weeks start on Sunday, the day
 * the `week` grain truncates to, so `this week` is always one `week` bucket.
 */
function startOf(unit: ProtocolRelativeDateUnit, day: number): number {
  const date = new Date(day);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (unit) {
    case 'day': return day;
    case 'week': return day - date.getUTCDay() * DAY_MS;
    case 'month': return Date.UTC(year, month, 1);
    case 'quarter': return Date.UTC(year, Math.floor(month / 3) * 3, 1);
    case 'year': return Date.UTC(year, 0, 1);
  }
}

/** `start` moved by `count` units; `start` is always the first day of its unit. */
function shift(unit: ProtocolRelativeDateUnit, start: number, count: number): number {
  if (unit === 'day') return start + count * DAY_MS;
  if (unit === 'week') return start + count * 7 * DAY_MS;
  const months = count * (unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12);
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function formatDate(day: number): string {
  const date = new Date(Math.max(day, EARLIEST));
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Resolve a relative range at `now` in `timezone`, or `undefined` when the
 * value is not in the grammar.
 *
 * - `this <unit>` includes the whole current period, future days included;
 * - `last <unit>` and `last N <unit>s` are whole periods ending where the
 *   current one starts, so they exclude it (`last 7 days` ends yesterday);
 * - `<unit> to date` runs from the current period's start through today.
 */
export function resolveRelativeDateRange(
  value: unknown,
  now: Date,
  timezone: string,
): ResolvedDateRange | undefined {
  const range = parseProtocolRelativeDateRange(value);
  if (!range) return undefined;
  const today = localToday(now, timezone);
  const tomorrow = today + DAY_MS;
  switch (range.kind) {
    case 'today':
      return { start: formatDate(today), end: formatDate(tomorrow) };
    case 'yesterday':
      return { start: formatDate(today - DAY_MS), end: formatDate(today) };
    case 'this': {
      const start = startOf(range.unit, today);
      return { start: formatDate(start), end: formatDate(shift(range.unit, start, 1)) };
    }
    case 'last': {
      const current = startOf(range.unit, today);
      return { start: formatDate(shift(range.unit, current, -range.count)), end: formatDate(current) };
    }
    case 'toDate':
      return { start: formatDate(startOf(range.unit, today)), end: formatDate(tomorrow) };
  }
}
