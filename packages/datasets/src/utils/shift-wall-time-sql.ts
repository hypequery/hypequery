import type { DatasetSqlClockPart, DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { MeasureTimeInterval, TimeGrain } from '../types.js';
import { calendarShiftAtFineGrain } from './shift-measure-grains.js';

const CLOCK_PARTS: readonly DatasetSqlClockPart[] = ['Hour', 'Minute', 'Second'];

/** Reject DST normalization that moves a shifted sub-day bucket to another local time. */
export function shiftWallTimeGuardSql(
  dialect: DatasetSqlDialectRules,
  interval: MeasureTimeInterval,
  grain: TimeGrain,
  source: string,
  period: string,
  lower: string,
  upper: string,
  end: string,
): string {
  if (!calendarShiftAtFineGrain(interval, grain) || (grain !== 'minute' && grain !== 'hour')) return '0';
  const changesWallTime = (value: string): string => {
    const shifted = dialect.subtractTime(value, interval.amount, interval.unit);
    return CLOCK_PARTS
      .map(part => `${dialect.clockPart(part, value)} != ${dialect.clockPart(part, shifted)}`)
      .join(' OR ');
  };
  const changed = `(${changesWallTime(period)}) OR (${changesWallTime(lower)})`
    + ` OR (${upper} != ${end} AND (${changesWallTime(upper)}))`;
  const guard = dialect.guard(`${dialect.countIf(changed)} > 0`,
    'Calendar shift lands on a nonexistent local time; use a UTC query timezone.');
  return `(SELECT ${guard} FROM ${source})`;
}
