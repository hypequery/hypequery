import type { MeasureTimeInterval, TimeGrain } from '../types.js';
import { subtractTimeSql } from './time-arithmetic-sql.js';
import { calendarShiftAtFineGrain } from './shift-measure-grains.js';

/** Reject DST normalization that moves a shifted sub-day bucket to another local time. */
export function shiftWallTimeGuardSql(
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
    const shifted = subtractTimeSql(value, interval.amount, interval.unit);
    return ['Hour', 'Minute', 'Second']
      .map(part => `to${part}(${value}) != to${part}(${shifted})`)
      .join(' OR ');
  };
  const changed = `(${changesWallTime(period)}) OR (${changesWallTime(lower)})`
    + ` OR (${upper} != ${end} AND (${changesWallTime(upper)}))`;
  return `(SELECT throwIf(countIf(${changed}) > 0, `
    + `'Calendar shift lands on a nonexistent local time; use a UTC query timezone.') FROM ${source})`;
}
