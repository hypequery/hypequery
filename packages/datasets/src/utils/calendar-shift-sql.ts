import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { MeasureTimeInterval } from '../types.js';

/**
 * Shift a point inside a bucket by a calendar interval, relative to the
 * bucket's shifted anchor rather than on its own.
 *
 * A calendar shift maps a whole bucket to its shifted start plus the bucket's
 * width, so the week of 2024-02-26 maps to 2024-01-26 + 7 days. A point inside
 * that bucket must land on the matching day of the shifted range. Shifting the
 * point independently does not: 2024-03-03 − 1 month is 2024-02-03, outside
 * the 2024-01-26 week, so a partial bucket's range came out empty or
 * overlapping the next week.
 *
 * The point keeps its own wall-clock time (calendar subtraction and day
 * addition both preserve it) and moves by whole calendar days to the anchor's
 * day plus the point's day offset within its bucket.
 */
export function anchoredCalendarShiftSql(dialect: DatasetSqlDialectRules, point: string, anchor: string, interval: MeasureTimeInterval): string {
  const shiftedPoint = dialect.subtractTime(point, interval.amount, interval.unit);
  const shiftedAnchor = dialect.subtractTime(anchor, interval.amount, interval.unit);
  const days = `${dialect.timeDiff('day', shiftedPoint, shiftedAnchor)} + ${dialect.timeDiff('day', anchor, point)}`;
  return dialect.addTime(shiftedPoint, days, 'day');
}
