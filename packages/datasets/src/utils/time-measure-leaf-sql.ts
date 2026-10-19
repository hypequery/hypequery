import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { WindowMeasureDefinition } from '../types.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import type { TimeMeasureSqlBase, TimeMeasureSqlDimension } from './time-measure-source-sql.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';
import { shiftRangePredicateSql } from './shift-measure-sql.js';
import { isCountAggregation } from './count-aggregations.js';

/** Keyed source membership retains distinct/average semantics and row multiplicity. */
export function timeMeasureLeafSql(dialect: DatasetSqlDialectRules, id: number, context: number, base: TimeMeasureSqlBase, window: WindowMeasureDefinition | undefined, axis: TimeMeasureAxis, dims: readonly TimeMeasureSqlDimension[]) {
  const keys = dims.map(dim => dim.alias);
  const ranges = `_hq_ranges${id}`;
  const rows = `_hq_rows${id}`;
  const aggregate = `_hq_leaf${id}`;
  const value = `_hq_value${id}`;
  const group = `_hq_period${keys.length ? `, ${keys.join(', ')}` : ''}`;
  const expression = dialect.windowAggregate(base.definition, base.value, base.arg);
  if (window?.cumulative) {
    const population = `_hq_history${id}`;
    const partial = `_hq_partial${id}`;
    const operation = base.definition.aggregation === 'count' ? 'sum' : base.definition.aggregation;
    const partition = dialect.packRow(keys.length ? keys : ['0']);
    const historyGroup = `_hq_time${keys.length ? `, ${keys.join(', ')}` : ''}`;
    return {
      ctes: [
        `${population} AS (SELECT * FROM _hq_source WHERE _hq_time < (SELECT max(_hq_eval_end) FROM _hq_context${context}))`,
        `${partial} AS (SELECT ${historyGroup}, ${partition} AS _hq_partition, ${dialect.toNullable(expression)} AS _hq_partial FROM ${population} GROUP BY ${historyGroup})`,
        `${aggregate} AS (SELECT _hq_time, _hq_partition, ${dialect.reaggregate(operation, '_hq_partial')} OVER (PARTITION BY _hq_partition ORDER BY _hq_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ${value} FROM ${partial})`,
      ],
      population, aggregate, context, cumulative: true, guard: '0',
      count: isCountAggregation(base.definition),
    };
  }
  const lower = window?.trailing ? dialect.subtractTime('_hq_eval_end', window.trailing.amount, window.trailing.unit)
    : window?.toDate ? dialect.truncateTime('_hq_eval_period', window.toDate) : '_hq_eval_lower';
  const upper = window ? '_hq_eval_end' : '_hq_eval_upper';
  const lowerInclusive = window ? '1' : '_hq_lower_inclusive';
  const upperInclusive = window ? '0' : '_hq_upper_inclusive';
  const first = dialect.truncateTime('_hq_scan_lower', axis.grain);
  const last = dialect.truncateTime('_hq_scan_upper', axis.grain);
  const partialUpper = dialect.ifElse(`_hq_scan_upper > ${last} OR _hq_scan_upper_inclusive`, '1', '0');
  const count = dialect.greatest('0', `${dialect.timeDiff(axis.grain, first, last)} + ${partialUpper}`);
  const fanout = window ? dialect.guard(`${count} > 1000`, 'A window row contributes to more than 1000 buckets.') : '0';
  const guard = `${fanout} + ${calendarBucketGuardSql(dialect, first, `${count} + ${fanout}`, axis.grain)}`;
  const predicate = shiftRangePredicateSql('r._hq_time', { lower: 'b._hq_scan_lower', upper: 'b._hq_scan_upper', lowerInclusive: 'b._hq_scan_lower_inclusive', upperInclusive: 'b._hq_scan_upper_inclusive' });
  return {
    ctes: [
      `${ranges} AS (SELECT _hq_period, ${lower} AS _hq_scan_lower, ${upper} AS _hq_scan_upper, ${lowerInclusive} AS _hq_scan_lower_inclusive, ${upperInclusive} AS _hq_scan_upper_inclusive FROM _hq_context${context})`,
      `_hq_keys${id} AS (SELECT *, ${dialect.addTime(first, dialect.seriesIndex(`${count} + ${guard}`), axis.grain)} AS _hq_source_period FROM ${ranges})`,
      `${rows} AS (SELECT r.*, b._hq_period FROM _hq_source AS r INNER JOIN _hq_keys${id} AS b ON ${dialect.truncateTime('r._hq_time', axis.grain)} = b._hq_source_period WHERE ${predicate})`,
      `${aggregate} AS (SELECT ${group}, ${dialect.toNullable(expression)} AS ${value} FROM ${rows} GROUP BY ${group})`,
    ],
    population: rows, aggregate, context, cumulative: false,
    guard: `(SELECT coalesce(max(${guard}), 0) FROM ${ranges})`, count: isCountAggregation(base.definition),
  };
}
