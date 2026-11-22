import type { TimeAxisRange } from './time-axis-bounds.js';

const DAY_MS = 86_400_000;

/** How far `timezone`'s wall clock is ahead of UTC at instant `at`. */
function zoneOffset(at: number, timezone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - Math.floor(at / 1000) * 1000;
}

/** A bound as an instant: an offset-free bound is a wall clock in the query zone, as the scan reads it. */
function boundInstant(bound: TimeAxisRange['start'], timezone: string): number {
  if (bound.hasOffset || timezone === 'UTC') return bound.milliseconds;
  // Two passes settle a wall clock next to a DST change.
  return bound.milliseconds - zoneOffset(bound.milliseconds - zoneOffset(bound.milliseconds, timezone), timezone);
}

/** The range's span in days, with both bounds read in the operation's zone (RFC 0025). */
export function eventRangeSpanDays(range: TimeAxisRange, timezone: string | undefined): number {
  const zone = timezone ?? 'UTC';
  return (boundInstant(range.end, zone) - boundInstant(range.start, zone)) / DAY_MS;
}
