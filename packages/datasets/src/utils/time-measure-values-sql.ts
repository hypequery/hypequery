import type { TimeGrain, WindowMeasureDefinition } from '../types.js';
import { GRAIN_FUNCTIONS } from '../constants.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import type { TimeMeasureSqlBase, TimeMeasureSqlDimension } from './time-measure-source-sql.js';
import { addTimeSql as add, subtractTimeSql as subtract } from './time-arithmetic-sql.js';
import { isCountAggregation, windowAggregateSql } from './window-aggregation-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';

export interface TimeMeasureSqlInput {
  name: string;
  base: TimeMeasureSqlBase;
  window?: WindowMeasureDefinition;
  /** Source rows mapped to output periods before aggregation. */
  rowsSql: string;
  /** Extra population CTEs, such as aligned shift ranges. */
  rowCtes?: string[];
  /** Shift populations already map exclusively to the requested output series. */
  restrictToAxis?: boolean;
}

/** One row is emitted into each bounded window it contributes to. */
function contributionSql(window: WindowMeasureDefinition | undefined, grain: TimeGrain): string {
  const bucket = `${GRAIN_FUNCTIONS[grain]}(_hq_time)`;
  if (!window) return bucket;
  if (window.cumulative) return `greatest(${bucket}, _hq_first)`;
  let count: string;
  if (window.trailing) {
    const end = add(bucket, window.trailing.amount, window.trailing.unit);
    count = `dateDiff('${grain}', ${bucket}, ${end})`;
  } else if (window.toDate) {
    const calendarStart = `${GRAIN_FUNCTIONS[window.toDate]}(_hq_time)`;
    const end = add(calendarStart, 1, window.toDate);
    count = `dateDiff('${grain}', ${bucket}, ${end})`;
  } else {
    throw new Error('Window measure has no supported mode.');
  }
  const fanoutGuard = `throwIf(${count} > 1000, 'A window row contributes to more than 1000 buckets.')`;
  const calendarGuard = calendarBucketGuardSql(bucket, `${count} + ${fanoutGuard}`, grain);
  const bucketIndices = `arrayJoin(range(toUInt64(${count} + ${fanoutGuard} + ${calendarGuard})))`;
  return add(bucket, bucketIndices, grain);
}

export function windowScanStartSql(window: WindowMeasureDefinition, grain: TimeGrain): string {
  if (window.trailing) return subtract(add('_hq_first', 1, grain), window.trailing.amount, window.trailing.unit);
  if (window.toDate) return `${GRAIN_FUNCTIONS[window.toDate]}(_hq_first)`;
  throw new Error('Cumulative windows have unbounded history.');
}

/** Base measures respect partial endpoints; windows use entire contributing buckets. */
export function windowMeasureRowsSql(window: WindowMeasureDefinition | undefined, axis: TimeMeasureAxis): string {
  const range = window ? '' : ` WHERE _hq_time ${axis.lowerInclusive ? '>=' : '>'} _hq_lower AND _hq_time ${axis.upperInclusive ? '<=' : '<'} _hq_upper`;
  return `SELECT *, ${contributionSql(window, axis.grain)} AS _hq_period FROM _hq_scanned${range}`;
}

/** Fill dimension combinations, aggregate populations, and join measure values onto the series. */
export function buildTimeMeasureValuesSql(
  dims: readonly TimeMeasureSqlDimension[],
  inputs: readonly TimeMeasureSqlInput[],
  axis: TimeMeasureAxis,
): string[] {
  const ctes: string[] = [];
  const keys = dims.map(dimension => dimension.alias);
  const combinations = keys.length
    ? ` CROSS JOIN (SELECT DISTINCT ${keys.join(', ')} FROM _hq_scanned) AS _hq_combinations`
    : '';
  ctes.push(`_hq_skeleton AS (SELECT * FROM _hq_series${combinations})`);
  const projections = ['s._hq_period AS period', ...dims.map(dimension => `s.${dimension.alias} AS ${quoteSQLIdentifier(dimension.name)}`)];
  const joins: string[] = [];
  let index = 0;
  for (const input of inputs) {
    const { name, base, window, rowsSql, rowCtes = [], restrictToAxis = true } = input;
    const output = `_hq_m${index}`;
    const fan = `_hq_fan${index}`;
    const aggregate = `_hq_agg${index}`;
    ctes.push(...rowCtes, `${fan} AS (${rowsSql})`);
    // toNullable makes unmatched LEFT JOIN values NULL regardless of join_use_nulls.
    const expression = windowAggregateSql(base.definition, base.value, base.arg);
    const groupColumns = `_hq_period${keys.length ? `, ${keys.join(', ')}` : ''}`;
    const outputRange = restrictToAxis ? ' WHERE _hq_period BETWEEN _hq_first AND _hq_last' : '';
    const trailingRange = window?.trailing
      ? ` AND _hq_time >= ${subtract(add('_hq_period', 1, axis.grain), window.trailing.amount, window.trailing.unit)}`
      : '';
    const aggregationSql = `SELECT ${groupColumns}, toNullable(${expression}) AS ${output}`
      + ` FROM ${fan}${outputRange}${trailingRange} GROUP BY ${groupColumns}`;
    ctes.push(`${aggregate} AS (${aggregationSql})`);
    const alias = `m${index}`;
    const condition = [`s._hq_period = ${alias}._hq_period`, ...keys.map(key => `isNotDistinctFrom(s.${key}, ${alias}.${key})`)];
    joins.push(`LEFT JOIN ${aggregate} AS ${alias} ON ${condition.join(' AND ')}`);
    let value = `${alias}.${output}`;
    if (window?.cumulative) {
      const operation = base.definition.aggregation === 'count' ? 'sum' : base.definition.aggregation;
      const partition = keys.length ? `PARTITION BY ${keys.map(key => `s.${key}`).join(', ')} ` : '';
      const frame = `${partition}ORDER BY s._hq_period ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`;
      value = `${operation}OrNull(${value}) OVER (${frame})`;
    }
    if (isCountAggregation(base.definition)) value = `coalesce(${value}, 0)`;
    projections.push(`${value} AS ${quoteSQLIdentifier(name)}`);
    index++;
  }
  ctes.push(`_hq_values AS (SELECT ${projections.join(', ')} FROM _hq_skeleton AS s ${joins.join(' ')})`);
  return ctes;
}
