import type { MeasureTimeInterval, TimeGrain } from '../types.js';
import { intervalBuckets } from './time-axis-intervals.js';

/** Calendar shifts preserve dates; they do not convert months into fixed durations. */
export function calendarShiftAtFineGrain(interval: MeasureTimeInterval, grain: TimeGrain): boolean {
  return ['month', 'quarter', 'year'].includes(interval.unit)
    && ['minute', 'hour', 'day', 'week'].includes(grain);
}

export function supportsShiftGrain(interval: MeasureTimeInterval, grain: TimeGrain): boolean {
  return calendarShiftAtFineGrain(interval, grain)
    || intervalBuckets(interval.amount, interval.unit, grain) !== undefined;
}
