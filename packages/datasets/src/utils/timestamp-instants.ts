import { parseTimeBound, type ParsedTimeBound } from './time-axis-bounds.js';

/**
 * Parse an RFC 3339 instant: ISO 8601 text carrying `Z` or a numeric offset,
 * the form `Date.prototype.toISOString` produces. Offset-free text is a local
 * reading rather than an instant and yields undefined, as does anything that
 * is not a timestamp.
 */
export function parseTimestampInstant(value: unknown): ParsedTimeBound | undefined {
  const instant = parseTimeBound(value);
  return instant?.hasOffset ? instant : undefined;
}

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

const CLOCK_PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
};

/**
 * The wall clock an instant shows in `timezone`, spelled
 * `YYYY-MM-DD hh:mm:ss[.fraction]`: the form ClickHouse reads as local time in
 * the zone of the DateTime64 it is compared against. Offsets are whole
 * minutes, so the authored sub-second digits survive unchanged; a zero
 * fraction is dropped.
 */
export function instantWallClock(instant: ParsedTimeBound, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { ...CLOCK_PARTS, timeZone: timezone })
    .formatToParts(new Date(instant.milliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value ?? '';
  const date = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  const clock = `${part('hour')}:${part('minute')}:${part('second')}`;
  const remainder = ((instant.nanoseconds % NANOSECONDS_PER_SECOND) + NANOSECONDS_PER_SECOND) % NANOSECONDS_PER_SECOND;
  const fraction = remainder === 0n ? '' : `.${remainder.toString().padStart(9, '0').replace(/0+$/, '')}`;
  return `${date} ${clock}${fraction}`;
}
