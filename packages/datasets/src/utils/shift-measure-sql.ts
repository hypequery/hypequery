import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { ShiftMeasureDefinition } from '../types.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import { calendarShiftAtFineGrain } from './shift-measure-grains.js';
import { shiftWallTimeGuardSql } from './shift-wall-time-sql.js';
import { anchoredCalendarShiftSql } from './calendar-shift-sql.js';

/** Preserve the selected portion of a bucket and both authored endpoint operators. */
export function shiftRangeSql(dialect: DatasetSqlDialectRules, shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, period?: string) {
  const first = period ?? '_hq_first';
  const last = period ?? '_hq_last';
  const end = dialect.addTime(last, 1, axis.grain);
  const calendar = calendarShiftAtFineGrain(shift.interval, axis.grain);
  // Clamp the bucket anchor, then retain its width. Independently clamping both
  // dates would turn March 30–31 into February 28–28, dropping an entire day.
  // A partial bucket keeps the matching slice of that shifted range, so both
  // bounds are placed relative to the anchor rather than shifted on their own.
  const shiftBound = (point: string, anchor: string) => calendar
    ? anchoredCalendarShiftSql(dialect, point, anchor, shift.interval)
    : dialect.subtractTime(point, shift.interval.amount, shift.interval.unit);
  const upper = shiftBound(dialect.least(end, '_hq_upper'), last);
  const shiftedEnd = dialect.addTime(dialect.subtractTime(last, shift.interval.amount, shift.interval.unit), 1, axis.grain);
  return {
    lower: shiftBound(dialect.greatest(first, '_hq_lower'), first),
    upper: calendar ? dialect.ifElse(`_hq_upper >= ${end}`, shiftedEnd, upper) : upper,
    lowerInclusive: period ? `(${period} > _hq_lower OR ${Number(axis.lowerInclusive)})` : String(Number(axis.lowerInclusive)),
    upperInclusive: `(_hq_upper < ${end} AND ${Number(axis.upperInclusive)})`,
  };
}

export function shiftRangePredicateSql(time: string, range: ReturnType<typeof shiftRangeSql>): string {
  return `(${time} > ${range.lower} OR (${range.lowerInclusive} AND ${time} = ${range.lower}))`
    + ` AND (${time} < ${range.upper} OR (${range.upperInclusive} AND ${time} = ${range.upper}))`;
}

/** Check the shifted scan independently of whether it contains source rows. */
export function shiftCalendarGuardSql(dialect: DatasetSqlDialectRules, shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, axisGuard: string): string {
  const { grain } = axis;
  const { lower, upper } = shiftRangeSql(dialect, shift, axis);
  const first = dialect.truncateTime(lower, grain);
  const last = dialect.truncateTime(upper, grain);
  const count = `${dialect.timeDiff(grain, first, last)} + ${axisGuard}`;
  return calendarBucketGuardSql(dialect, first, count, grain);
}

/** Validate each output bucket after the series exists, including empty source populations. */
export function shiftWallTimeSeriesGuardSql(dialect: DatasetSqlDialectRules, shift: ShiftMeasureDefinition, grain: TimeMeasureAxis['grain']): string {
  const end = dialect.addTime('_hq_period', 1, grain);
  return shiftWallTimeGuardSql(
    dialect, shift.interval, grain, '_hq_series CROSS JOIN _hq_bounds',
    '_hq_period', dialect.greatest('_hq_period', '_hq_lower'), dialect.least(end, '_hq_upper'), end,
  );
}

/** Map output buckets to their earlier half-open ranges, retaining calendar arithmetic. */
export function shiftBucketCtes(dialect: DatasetSqlDialectRules, shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, index: number): { ctes: string[]; rowsSql: string; sourceTimesSql: string } {
  const { grain } = axis;
  const ranges = `_hq_shift_ranges${index}`;
  const keys = `_hq_shift_keys${index}`;
  const range = shiftRangeSql(dialect, shift, axis, '_hq_period');
  const bucket = dialect.truncateTime('_hq_shift_lower', grain);
  const upperBucket = dialect.truncateTime('_hq_shift_upper', grain);
  const partialUpper = dialect.ifElse(`_hq_shift_upper > ${upperBucket} OR _hq_shift_upper_inclusive`, '1', '0');
  const count = dialect.greatest('0', `${dialect.timeDiff(grain, bucket, upperBucket)} + ${partialUpper}`);
  const join = ` AS r INNER JOIN ${keys} AS b ON ${dialect.truncateTime('r._hq_time', grain)} = b._hq_source_period WHERE ${shiftRangePredicateSql('r._hq_time', { lower: 'b._hq_shift_lower', upper: 'b._hq_shift_upper', lowerInclusive: 'b._hq_shift_lower_inclusive', upperInclusive: 'b._hq_shift_upper_inclusive' })}`;
  return {
    // Membership preserves duplicate source rows while excluding dates and
    // partial ranges that no output bucket maps to, including clamped overlaps.
    sourceTimesSql: `SELECT r._hq_time FROM _hq_source${join}`,
    ctes: [
      `${ranges} AS (SELECT _hq_period, ${range.lower} AS _hq_shift_lower, ${range.upper} AS _hq_shift_upper, ${range.lowerInclusive} AS _hq_shift_lower_inclusive, ${range.upperInclusive} AS _hq_shift_upper_inclusive FROM _hq_series CROSS JOIN _hq_bounds)`,
      // A DST transition can map a one-hour output bucket to zero or two
      // source hours. Enumerate source bucket keys and keep exact endpoints.
      // The equality join avoids a source-rows × output-series Cartesian product.
      `${keys} AS (SELECT *, ${dialect.addTime(bucket, dialect.seriesIndex(count), grain)} AS _hq_source_period FROM ${ranges})`,
    ],
    rowsSql: `SELECT r.*, b._hq_period FROM _hq_scanned${join}`,
  };
}
