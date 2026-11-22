import type { AnyDatasetInstance, DatasetFilterNode, DatasetQuery, TimeGrain } from '../types.js';
import { nestedFilterLeaves } from './filter-tree.js';
import { isSupportedTimeGrain } from '../constants.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { isShiftMeasure } from './dataset-measures.js';

import { resolveTimeAxisRange, isDefinitelyEmptyTimeRange, isTimeAxisFilter } from './time-axis-bounds.js';
import { windowGrainErrors, estimateTimeAxisBuckets, exceedsEstimatedTimeAxisLimit } from './time-axis-intervals.js';
import { supportsShiftGrain } from './shift-measure-grains.js';

export { intervalBuckets, utcBucketStart } from './time-axis-intervals.js';

export interface TimeMeasureAxis {
  grain: TimeGrain;
  lower: string;
  upper: string;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  filters: DatasetFilterNode[];
  /** UTC estimate; execution enforces the exact timezone-aware count. */
  bucketCount: number;
  resultLimit?: number;
}

/** Validate time-measure grains, resolve bounds, then estimate the output series. */
export function analyzeTimeMeasureAxis(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
): { axis?: TimeMeasureAxis; errors: string[] } {
  const timeMeasures = selectedTimeMeasures(dataset, query);
  if (timeMeasures.size === 0 && query.fill !== true) return { errors: [] };
  const errors: string[] = [];
  const subjects = timeMeasures.size === 0
    ? 'Filled queries'
    : [...timeMeasures.values()].some(isShiftMeasure) ? 'Window and shift measures' : 'Window measures';
  if (!isSupportedTimeGrain(query.by)) return { errors: [`${subjects} require a supported "by" grain.`] };
  const grain = query.by;
  for (const [name, window] of timeMeasures) {
    if (isShiftMeasure(window)) {
      if (!supportsShiftGrain(window.interval, grain)) errors.push(`Shift measure "${name}" must span whole "${grain}" buckets.`);
      continue;
    }
    errors.push(...windowGrainErrors(name, window, grain));
  }
  if (nestedFilterLeaves(query.filters).some(filter => isTimeAxisFilter(dataset, filter))) {
    return { errors: [...errors, `${subjects} need their time range as top-level filters: a time-axis comparison inside "or" or "not" cannot bound the series.`] };
  }
  const range = resolveTimeAxisRange(dataset, query.filters ?? []);
  if (!range) {
    return { errors: [...errors, `${subjects} require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.`] };
  }
  if (isDefinitelyEmptyTimeRange(range)) {
    return { errors: [...errors, 'Window measure time range must be non-empty and ordered.'] };
  }

  const { start, end, lowerInclusive, upperInclusive, filters } = range;
  const bucketCount = estimateTimeAxisBuckets(start, end, upperInclusive, grain);
  const resultLimit = query.limit ?? dataset.limits?.maxResultSize;
  if (exceedsEstimatedTimeAxisLimit(start, end, grain, bucketCount, resultLimit)) {
    errors.push(`Window series exceeds the effective result limit of ${resultLimit} buckets.`);
  }
  return {
    errors,
    axis: {
      grain, lower: start.text, upper: end.text,
      lowerInclusive, upperInclusive, filters, bucketCount, resultLimit,
    },
  };
}
