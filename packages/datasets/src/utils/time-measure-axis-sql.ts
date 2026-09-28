import { GRAIN_FUNCTIONS } from '../constants.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import type { TimeMeasureSqlSource } from './time-measure-source-sql.js';
import { addTimeSql as add, subtractTimeSql as subtract } from './time-arithmetic-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import type { ShiftMeasureDefinition } from '../types.js';
import { shiftCalendarGuardSql } from './shift-measure-sql.js';

export interface TimeMeasureSqlAxis {
  ctes: string[];
  timeAxisSql: string;
  guard: string;
  rangeGuard: string;
}

function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Build bounded output buckets using the query timezone. */
export function buildTimeMeasureAxisSql(
  source: TimeMeasureSqlSource,
  axis: TimeMeasureAxis,
  shifts: readonly ShiftMeasureDefinition[] = [],
): TimeMeasureSqlAxis {
  const first = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_lower)`;
  const upperBucket = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_upper)`;
  const last = axis.upperInclusive
    ? upperBucket
    : `if(_hq_upper = ${upperBucket}, ${subtract(upperBucket, 1, axis.grain)}, ${upperBucket})`;
  const count = `dateDiff('${axis.grain}', _hq_first, _hq_last) + 1`;
  const emptyRange = axis.lowerInclusive && axis.upperInclusive ? '' : ' OR _hq_lower = _hq_upper';
  const rangeGuard = `throwIf(_hq_lower > _hq_upper${emptyRange}, 'Window measure time range must be non-empty and ordered.')`;
  const limitGuard = axis.resultLimit === undefined
    ? '0'
    : `throwIf(${count} > ${axis.resultLimit}, 'Window series exceeds the effective result limit of ${axis.resultLimit} buckets.')`;
  const calendarGuard = calendarBucketGuardSql('_hq_first', `${count} + ${limitGuard} + ${rangeGuard}`, axis.grain);

  const physicalTimeType = `toTypeName(tupleElement((SELECT ${source.rowAlias} FROM _hq_raw LIMIT 0), 1))`;
  const physicalGuard = axis.grain === 'minute' || axis.grain === 'hour'
    ? `throwIf(position(${physicalTimeType}, 'Date') > 0 AND position(${physicalTimeType}, 'DateTime') = 0, 'Sub-day time measures require a time-of-day column; Date and Date32 are not supported.')`
    : '0';
  const shiftGuards = shifts.map(shift => shiftCalendarGuardSql(shift, axis.grain, `${limitGuard} + ${rangeGuard}`));
  const guard = [limitGuard, physicalGuard, calendarGuard, ...shiftGuards].join(' + ');

  // A zero-row scalar retains the converted timestamp type and query timezone.
  // Reading any(time) here would scan the entire population just for its type.
  const timezone = 'timezoneOf(assumeNotNull((SELECT _hq_time FROM _hq_source LIMIT 0)))';
  const bounds = [
    `parseDateTime64BestEffort(${literal(axis.lower)}, 9, ${timezone}) AS _hq_lower`,
    `parseDateTime64BestEffort(${literal(axis.upper)}, 9, ${timezone}) AS _hq_upper`,
    `${first} AS _hq_first`,
    `${last} AS _hq_last`,
  ];
  const bucketIndices = `arrayJoin(range(toUInt64(${count} + ${guard} + ${rangeGuard})))`;
  const period = add('_hq_first', bucketIndices, axis.grain);
  const ctes = [
    `_hq_bounds AS (SELECT ${bounds.join(', ')})`,
    `_hq_series AS (SELECT ${period} AS _hq_period FROM _hq_bounds)`,
  ];
  // Always check the singleton axis before aggregating. ClickHouse can skip
  // a series guard when a dimensional CROSS JOIN has an empty population.
  const timeAxisSql = `WITH ${[...source.ctes, ctes[0]].join(',\n')} SELECT ${guard} + ${rangeGuard} AS _hq_validated FROM _hq_bounds`;
  return { ctes, timeAxisSql, guard, rangeGuard };
}
