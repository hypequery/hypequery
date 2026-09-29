import type { MeasureEvaluationContext } from './measure-evaluation-graph.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import { addTimeSql as add, subtractTimeSql as subtract } from './time-arithmetic-sql.js';
import { calendarShiftAtFineGrain } from './shift-measure-grains.js';
import { calendarBucketGuardSql } from './time-axis-calendar-guard.js';

/** Keep output coordinates separate from each shifted evaluation interval. */
export function timeMeasureContextCtes(contexts: readonly MeasureEvaluationContext[], axis: TimeMeasureAxis): string[] {
  const end = add('_hq_period', 1, axis.grain);
  const root = `_hq_context0 AS (SELECT _hq_period, _hq_period AS _hq_eval_period, ${end} AS _hq_eval_end, greatest(_hq_period, _hq_lower) AS _hq_eval_lower, least(${end}, _hq_upper) AS _hq_eval_upper, (_hq_period > _hq_lower OR ${Number(axis.lowerInclusive)}) AS _hq_lower_inclusive, (_hq_upper < ${end} AND ${Number(axis.upperInclusive)}) AS _hq_upper_inclusive FROM _hq_series CROSS JOIN _hq_bounds)`;
  return [root, ...contexts.slice(1).map(context => {
    const interval = context.interval!;
    const shift = (value: string) => subtract(`p.${value}`, interval.amount, interval.unit);
    const period = shift('_hq_eval_period');
    const shiftedEnd = calendarShiftAtFineGrain(interval, axis.grain) ? add(period, 1, axis.grain) : shift('_hq_eval_end');
    return `_hq_context${context.id} AS (SELECT p._hq_period, ${period} AS _hq_eval_period, ${shiftedEnd} AS _hq_eval_end, ${shift('_hq_eval_lower')} AS _hq_eval_lower, if(p._hq_eval_upper = p._hq_eval_end, ${shiftedEnd}, ${shift('_hq_eval_upper')}) AS _hq_eval_upper, p._hq_lower_inclusive, p._hq_upper_inclusive FROM _hq_context${context.parent} AS p)`;
  })];
}

export function timeMeasureContextGuard(context: MeasureEvaluationContext, axis: TimeMeasureAxis): string {
  const guard = calendarBucketGuardSql('_hq_eval_period', '1', axis.grain);
  return `(SELECT coalesce(max(${guard}), 0) FROM _hq_context${context.id})`;
}
