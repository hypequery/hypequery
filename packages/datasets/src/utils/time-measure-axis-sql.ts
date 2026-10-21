import type { StatementParameters } from './statement-parameters.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import type { TimeMeasureSqlSource } from './time-measure-source-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import type { ShiftMeasureDefinition } from '../types.js';
import { shiftCalendarGuardSql, shiftWallTimeSeriesGuardSql } from './shift-measure-sql.js';

export interface TimeMeasureSqlAxis {
  ctes: string[];
  timeAxisSql: string;
  guard: string;
  rangeGuard: string;
  postSeriesGuard: string;
}

/** Build bounded output buckets using the query timezone. */
export function buildTimeMeasureAxisSql(
  statement: StatementParameters,
  source: TimeMeasureSqlSource,
  axis: TimeMeasureAxis,
  shifts: readonly ShiftMeasureDefinition[] = [],
): TimeMeasureSqlAxis {
  const { dialect } = statement;
  const first = dialect.truncateTime('_hq_lower', axis.grain);
  const upperBucket = dialect.truncateTime('_hq_upper', axis.grain);
  const last = axis.upperInclusive
    ? upperBucket
    : dialect.ifElse(`_hq_upper = ${upperBucket}`, dialect.subtractTime(upperBucket, 1, axis.grain), upperBucket);
  const count = `${dialect.timeDiff(axis.grain, '_hq_first', '_hq_last')} + 1`;
  const emptyRange = axis.lowerInclusive && axis.upperInclusive ? '' : ' OR _hq_lower = _hq_upper';
  const rangeGuard = dialect.guard(`_hq_lower > _hq_upper${emptyRange}`, 'Window measure time range must be non-empty and ordered.');
  const limitGuard = axis.resultLimit === undefined
    ? '0'
    : dialect.guard(`${count} > ${axis.resultLimit}`, `Window series exceeds the effective result limit of ${axis.resultLimit} buckets.`);
  const calendarGuard = calendarBucketGuardSql(dialect, '_hq_first', `${count} + ${limitGuard} + ${rangeGuard}`, axis.grain);

  const physicalTime = dialect.rowElement(`(SELECT ${source.rowAlias} FROM _hq_raw LIMIT 0)`, 1);
  const physicalGuard = axis.grain === 'minute' || axis.grain === 'hour'
    ? dialect.guard(dialect.isDateOnlyType(physicalTime), 'Sub-day time measures require a time-of-day column; Date and Date32 are not supported.')
    : '0';
  const shiftGuards = shifts.map(shift => shiftCalendarGuardSql(dialect, shift, axis, `${limitGuard} + ${rangeGuard}`));
  const guard = [limitGuard, physicalGuard, calendarGuard, ...shiftGuards].join(' + ');
  const postSeriesGuard = shifts.map(shift => shiftWallTimeSeriesGuardSql(dialect, shift, axis.grain)).join(' + ') || '0';

  // A zero-row scalar retains the converted timestamp type and query timezone.
  // Reading any(time) here would scan the entire population just for its type.
  const timezone = dialect.timezoneOf(dialect.assumeNotNull('(SELECT _hq_time FROM _hq_source LIMIT 0)'));
  const bounds = [
    // The bounds come from the caller's time filter: bind them, never inline them.
    `${dialect.parseTimestamp(statement.bind(axis.lower, 'string'), timezone)} AS _hq_lower`,
    `${dialect.parseTimestamp(statement.bind(axis.upper, 'string'), timezone)} AS _hq_upper`,
    `${first} AS _hq_first`,
    `${last} AS _hq_last`,
  ];
  const bucketIndices = dialect.seriesIndex(`${count} + ${guard} + ${rangeGuard}`);
  const period = dialect.addTime('_hq_first', bucketIndices, axis.grain);
  const ctes = [
    `_hq_bounds AS (SELECT ${bounds.join(', ')})`,
    `_hq_series AS (SELECT ${period} AS _hq_period FROM _hq_bounds)`,
  ];
  // Always check the singleton axis before aggregating. ClickHouse can skip
  // a series guard when a dimensional CROSS JOIN has an empty population.
  const timeAxisSql = `WITH ${[...source.ctes, ...ctes].join(',\n')} SELECT ${guard} + ${rangeGuard} + ${postSeriesGuard} AS _hq_validated FROM _hq_bounds`;
  return { ctes, timeAxisSql, guard, rangeGuard, postSeriesGuard };
}
