import { GRAIN_FUNCTIONS } from '../constants.js';
import type { WindowMeasureDefinition } from '../types.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import type { TimeMeasureSqlBase, TimeMeasureSqlDimension } from './time-measure-source-sql.js';
import { addTimeSql as add, subtractTimeSql as subtract } from './time-arithmetic-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import { shiftRangePredicateSql } from './shift-measure-sql.js';
import { isCountAggregation, windowAggregateSql } from './window-aggregation-sql.js';

/** Keyed source membership retains distinct/average semantics and row multiplicity. */
export function timeMeasureLeafSql(id: number, context: number, base: TimeMeasureSqlBase, window: WindowMeasureDefinition | undefined, axis: TimeMeasureAxis, dims: readonly TimeMeasureSqlDimension[]) {
  const keys = dims.map(dim => dim.alias);
  const ranges = `_hq_ranges${id}`;
  const rows = `_hq_rows${id}`;
  const aggregate = `_hq_leaf${id}`;
  const value = `_hq_value${id}`;
  const group = `_hq_period${keys.length ? `, ${keys.join(', ')}` : ''}`;
  const expression = windowAggregateSql(base.definition, base.value, base.arg);
  if (window?.cumulative) {
    const population = `_hq_history${id}`;
    const partial = `_hq_partial${id}`;
    const operation = base.definition.aggregation === 'count' ? 'sum' : base.definition.aggregation;
    const partition = keys.length ? `tuple(${keys.join(', ')})` : 'tuple(0)';
    const historyGroup = `_hq_time${keys.length ? `, ${keys.join(', ')}` : ''}`;
    return {
      ctes: [
        `${population} AS (SELECT * FROM _hq_source WHERE _hq_time < (SELECT max(_hq_eval_end) FROM _hq_context${context}))`,
        `${partial} AS (SELECT ${historyGroup}, ${partition} AS _hq_partition, toNullable(${expression}) AS _hq_partial FROM ${population} GROUP BY ${historyGroup})`,
        `${aggregate} AS (SELECT _hq_time, _hq_partition, ${operation}OrNull(_hq_partial) OVER (PARTITION BY _hq_partition ORDER BY _hq_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ${value} FROM ${partial})`,
      ],
      population, aggregate, context, cumulative: true, guard: '0',
      count: isCountAggregation(base.definition),
    };
  }
  const lower = window?.trailing ? subtract('_hq_eval_end', window.trailing.amount, window.trailing.unit)
    : window?.toDate ? `${GRAIN_FUNCTIONS[window.toDate]}(_hq_eval_period)` : '_hq_eval_lower';
  const upper = window ? '_hq_eval_end' : '_hq_eval_upper';
  const lowerInclusive = window ? '1' : '_hq_lower_inclusive';
  const upperInclusive = window ? '0' : '_hq_upper_inclusive';
  const first = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_scan_lower)`;
  const last = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_scan_upper)`;
  const count = `greatest(0, dateDiff('${axis.grain}', ${first}, ${last}) + if(_hq_scan_upper > ${last} OR _hq_scan_upper_inclusive, 1, 0))`;
  const fanout = window ? `throwIf(${count} > 1000, 'A window row contributes to more than 1000 buckets.')` : '0';
  const guard = `${fanout} + ${calendarBucketGuardSql(first, `${count} + ${fanout}`, axis.grain)}`;
  const predicate = shiftRangePredicateSql('r._hq_time', { lower: 'b._hq_scan_lower', upper: 'b._hq_scan_upper', lowerInclusive: 'b._hq_scan_lower_inclusive', upperInclusive: 'b._hq_scan_upper_inclusive' });
  return {
    ctes: [
      `${ranges} AS (SELECT _hq_period, ${lower} AS _hq_scan_lower, ${upper} AS _hq_scan_upper, ${lowerInclusive} AS _hq_scan_lower_inclusive, ${upperInclusive} AS _hq_scan_upper_inclusive FROM _hq_context${context})`,
      `_hq_keys${id} AS (SELECT *, ${add(first, `arrayJoin(range(toUInt64(${count} + ${guard})))`, axis.grain)} AS _hq_source_period FROM ${ranges})`,
      `${rows} AS (SELECT r.*, b._hq_period FROM _hq_source AS r INNER JOIN _hq_keys${id} AS b ON ${GRAIN_FUNCTIONS[axis.grain]}(r._hq_time) = b._hq_source_period WHERE ${predicate})`,
      `${aggregate} AS (SELECT ${group}, toNullable(${expression}) AS ${value} FROM ${rows} GROUP BY ${group})`,
    ],
    population: rows, aggregate, context, cumulative: false,
    guard: `(SELECT coalesce(max(${guard}), 0) FROM ${ranges})`, count: isCountAggregation(base.definition),
  };
}
