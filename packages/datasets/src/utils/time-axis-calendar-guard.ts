import type { TimeGrain } from '../types.js';
import { addTimeSql } from './time-arithmetic-sql.js';

/**
 * Calendar arithmetic can clamp a nonexistent date onto the previous bucket
 * (for example Pacific/Apia, 2011-12-30). Reject non-increasing bucket starts:
 * repeating them would duplicate aggregates and cumulative contributions.
 * `count` must already include the series/fanout guards, bounding enumeration.
 */
export function calendarBucketGuardSql(start: string, count: string, grain: TimeGrain): string {
  if (grain === 'minute' || grain === 'hour') return '0';
  const current = addTimeSql(start, '_hq_calendar_index', grain);
  const next = addTimeSql(start, '_hq_calendar_index + 1', grain);
  // Include the end boundary, which also bounds the source-row scan.
  const indices = `range(toUInt64(greatest(1, ${count})))`;
  return `throwIf(arrayExists(_hq_calendar_index -> ${next} <= ${current}, ${indices}), `
    + "'Time range crosses a skipped local calendar bucket; use a UTC time key for this range.')";
}
