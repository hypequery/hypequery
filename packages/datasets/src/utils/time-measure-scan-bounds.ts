import type { AnyDatasetInstance, DatasetQuery, TimeGrain } from '../types.js';
import { isShiftMeasure } from './dataset-measures.js';
import { parseTimeBound } from './time-axis-bounds.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import { selectedTimeMeasures } from './time-query-measures.js';

const DAY_MS = 86_400_000;

/** An upper bound on each unit's length: calendar units take their longest span. */
const UNIT_MS: Record<TimeGrain, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 31 * DAY_MS,
  quarter: 92 * DAY_MS,
  year: 366 * DAY_MS,
};

/** Covers any query-zone offset (UTC-12 to UTC+14) and a DST shift around it. */
const ZONE_MARGIN_MS = 2 * DAY_MS;

/** Instant bounds (`Z` timestamps) on the source rows a time-measure query can read. */
export interface TimeMeasureScanBounds {
  /** Absent when a cumulative measure needs all earlier history. */
  readonly lower?: string;
  readonly upper: string;
}

/**
 * A conservative range of source rows a time-measure query can read: the
 * output axis widened by one grain, every lookback the selected measures need
 * (the longest window, plus every shift, since shifts compose), and a margin
 * for the query timezone. Exact filtering still happens in the planned SQL;
 * this only lets the engine skip rows outside it, and use a time-key index.
 */
export function timeMeasureScanBounds(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  axis: Pick<TimeMeasureAxis, 'lower' | 'upper' | 'grain'>,
): TimeMeasureScanBounds | undefined {
  const lower = parseTimeBound(axis.lower);
  const upper = parseTimeBound(axis.upper);
  if (!lower || !upper) return undefined;

  let window = 0;
  let shifts = 0;
  let unbounded = false;
  for (const measure of selectedTimeMeasures(ds, query).values()) {
    if (isShiftMeasure(measure)) {
      shifts += measure.interval.amount * UNIT_MS[measure.interval.unit];
    } else if (measure.cumulative) {
      unbounded = true;
    } else if (measure.trailing) {
      window = Math.max(window, measure.trailing.amount * UNIT_MS[measure.trailing.unit]);
    } else if (measure.toDate) {
      window = Math.max(window, UNIT_MS[measure.toDate]);
    }
  }

  const grain = UNIT_MS[axis.grain];
  const instant = (milliseconds: number) => new Date(milliseconds).toISOString();
  return {
    ...(unbounded ? {} : { lower: instant(lower.milliseconds - grain - window - shifts - ZONE_MARGIN_MS) }),
    upper: instant(upper.milliseconds + grain + ZONE_MARGIN_MS),
  };
}
