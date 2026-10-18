import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { TimeGrain } from '../types.js';

/**
 * Calendar arithmetic can clamp a nonexistent date onto the previous bucket
 * (for example Pacific/Apia, 2011-12-30). Reject non-increasing bucket starts:
 * repeating them would duplicate aggregates and cumulative contributions.
 * `count` must already include the series/fanout guards, bounding enumeration.
 */
export function calendarBucketGuardSql(dialect: DatasetSqlDialectRules, start: string, count: string, grain: TimeGrain): string {
  if (grain === 'minute' || grain === 'hour') return '0';
  const index = '_hq_calendar_index';
  const current = dialect.addTime(start, index, grain);
  const next = dialect.addTime(start, `${index} + 1`, grain);
  // Include the end boundary, which also bounds the source-row scan.
  return dialect.guard(
    dialect.anyIndex(index, dialect.greatest('1', count), `${next} <= ${current}`),
    'Time range crosses a skipped local calendar bucket; use a UTC time key for this range.',
  );
}
