import type { ShiftMeasureDefinition, TimeGrain } from '../types.js';
import { GRAIN_FUNCTIONS } from '../constants.js';
import { addTimeSql, subtractTimeSql } from './time-arithmetic-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';

/** Check the shifted scan independently of whether it contains source rows. */
export function shiftCalendarGuardSql(shift: ShiftMeasureDefinition, grain: TimeGrain, axisGuard: string): string {
  const lower = subtractTimeSql('_hq_first', shift.interval.amount, shift.interval.unit);
  const upper = subtractTimeSql(addTimeSql('_hq_last', 1, grain), shift.interval.amount, shift.interval.unit);
  const first = `${GRAIN_FUNCTIONS[grain]}(${lower})`;
  const last = `${GRAIN_FUNCTIONS[grain]}(${upper})`;
  const count = `dateDiff('${grain}', ${first}, ${last}) + ${axisGuard}`;
  return calendarBucketGuardSql(first, count, grain);
}

/** Map output buckets to their earlier half-open ranges, retaining calendar arithmetic. */
export function shiftBucketCtes(shift: ShiftMeasureDefinition, grain: TimeGrain, index: number): { ctes: string[]; rowsSql: string } {
  const ranges = `_hq_shift_ranges${index}`;
  const keys = `_hq_shift_keys${index}`;
  const lower = subtractTimeSql('_hq_period', shift.interval.amount, shift.interval.unit);
  const upper = subtractTimeSql(addTimeSql('_hq_period', 1, grain), shift.interval.amount, shift.interval.unit);
  const bucket = `${GRAIN_FUNCTIONS[grain]}(_hq_shift_lower)`;
  const upperBucket = `${GRAIN_FUNCTIONS[grain]}(_hq_shift_upper)`;
  const count = `greatest(0, dateDiff('${grain}', ${bucket}, ${upperBucket}) + if(_hq_shift_upper > ${upperBucket}, 1, 0))`;
  return {
    ctes: [
      `${ranges} AS (SELECT _hq_period, ${lower} AS _hq_shift_lower, ${upper} AS _hq_shift_upper FROM _hq_series)`,
      // A DST transition can map a one-hour output bucket to zero or two
      // source hours. Enumerate source bucket keys and keep exact endpoints.
      // The equality join avoids a source-rows × output-series Cartesian product.
      `${keys} AS (SELECT *, ${addTimeSql(bucket, `arrayJoin(range(toUInt64(${count})))`, grain)} AS _hq_source_period FROM ${ranges})`,
    ],
    rowsSql: `SELECT r.*, b._hq_period FROM _hq_scanned AS r INNER JOIN ${keys} AS b ON ${GRAIN_FUNCTIONS[grain]}(r._hq_time) = b._hq_source_period WHERE r._hq_time >= b._hq_shift_lower AND r._hq_time < b._hq_shift_upper`,
  };
}
