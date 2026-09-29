import type { ShiftMeasureDefinition } from '../types.js';
import { GRAIN_FUNCTIONS } from '../constants.js';
import { addTimeSql, subtractTimeSql } from './time-arithmetic-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import { calendarShiftAtFineGrain } from './shift-measure-grains.js';
import { shiftWallTimeGuardSql } from './shift-wall-time-sql.js';

/** Preserve the selected portion of a bucket and both authored endpoint operators. */
export function shiftRangeSql(shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, period?: string) {
  const first = period ?? '_hq_first';
  const last = period ?? '_hq_last';
  const end = addTimeSql(last, 1, axis.grain);
  const upper = subtractTimeSql(`least(${end}, _hq_upper)`, shift.interval.amount, shift.interval.unit);
  // Clamp the bucket anchor, then retain its width. Independently clamping both
  // dates would turn March 30–31 into February 28–28, dropping an entire day.
  const shiftedEnd = addTimeSql(subtractTimeSql(last, shift.interval.amount, shift.interval.unit), 1, axis.grain);
  return {
    lower: subtractTimeSql(`greatest(${first}, _hq_lower)`, shift.interval.amount, shift.interval.unit),
    upper: calendarShiftAtFineGrain(shift.interval, axis.grain) ? `if(_hq_upper >= ${end}, ${shiftedEnd}, ${upper})` : upper,
    lowerInclusive: period ? `(${period} > _hq_lower OR ${Number(axis.lowerInclusive)})` : String(Number(axis.lowerInclusive)),
    upperInclusive: `(_hq_upper < ${end} AND ${Number(axis.upperInclusive)})`,
  };
}

export function shiftRangePredicateSql(time: string, range: ReturnType<typeof shiftRangeSql>): string {
  return `(${time} > ${range.lower} OR (${range.lowerInclusive} AND ${time} = ${range.lower}))`
    + ` AND (${time} < ${range.upper} OR (${range.upperInclusive} AND ${time} = ${range.upper}))`;
}

/** Check the shifted scan independently of whether it contains source rows. */
export function shiftCalendarGuardSql(shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, axisGuard: string): string {
  const { grain } = axis;
  const { lower, upper } = shiftRangeSql(shift, axis);
  const first = `${GRAIN_FUNCTIONS[grain]}(${lower})`;
  const last = `${GRAIN_FUNCTIONS[grain]}(${upper})`;
  const count = `dateDiff('${grain}', ${first}, ${last}) + ${axisGuard}`;
  return calendarBucketGuardSql(first, count, grain);
}

/** Validate each output bucket after the series exists, including empty source populations. */
export function shiftWallTimeSeriesGuardSql(shift: ShiftMeasureDefinition, grain: TimeMeasureAxis['grain']): string {
  const end = addTimeSql('_hq_period', 1, grain);
  return shiftWallTimeGuardSql(
    shift.interval, grain, '_hq_series CROSS JOIN _hq_bounds',
    '_hq_period', 'greatest(_hq_period, _hq_lower)', `least(${end}, _hq_upper)`, end,
  );
}

/** Map output buckets to their earlier half-open ranges, retaining calendar arithmetic. */
export function shiftBucketCtes(shift: ShiftMeasureDefinition, axis: TimeMeasureAxis, index: number): { ctes: string[]; rowsSql: string; sourceTimesSql: string } {
  const { grain } = axis;
  const ranges = `_hq_shift_ranges${index}`;
  const keys = `_hq_shift_keys${index}`;
  const range = shiftRangeSql(shift, axis, '_hq_period');
  const bucket = `${GRAIN_FUNCTIONS[grain]}(_hq_shift_lower)`;
  const upperBucket = `${GRAIN_FUNCTIONS[grain]}(_hq_shift_upper)`;
  const count = `greatest(0, dateDiff('${grain}', ${bucket}, ${upperBucket}) + if(_hq_shift_upper > ${upperBucket} OR _hq_shift_upper_inclusive, 1, 0))`;
  const join = ` AS r INNER JOIN ${keys} AS b ON ${GRAIN_FUNCTIONS[grain]}(r._hq_time) = b._hq_source_period WHERE ${shiftRangePredicateSql('r._hq_time', { lower: 'b._hq_shift_lower', upper: 'b._hq_shift_upper', lowerInclusive: 'b._hq_shift_lower_inclusive', upperInclusive: 'b._hq_shift_upper_inclusive' })}`;
  return {
    // Membership preserves duplicate source rows while excluding dates and
    // partial ranges that no output bucket maps to, including clamped overlaps.
    sourceTimesSql: `SELECT r._hq_time FROM _hq_source${join}`,
    ctes: [
      `${ranges} AS (SELECT _hq_period, ${range.lower} AS _hq_shift_lower, ${range.upper} AS _hq_shift_upper, ${range.lowerInclusive} AS _hq_shift_lower_inclusive, ${range.upperInclusive} AS _hq_shift_upper_inclusive FROM _hq_series CROSS JOIN _hq_bounds)`,
      // A DST transition can map a one-hour output bucket to zero or two
      // source hours. Enumerate source bucket keys and keep exact endpoints.
      // The equality join avoids a source-rows × output-series Cartesian product.
      `${keys} AS (SELECT *, ${addTimeSql(bucket, `arrayJoin(range(toUInt64(${count})))`, grain)} AS _hq_source_period FROM ${ranges})`,
    ],
    rowsSql: `SELECT r.*, b._hq_period FROM _hq_scanned${join}`,
  };
}
