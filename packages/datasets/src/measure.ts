import { createMeasureHelper, createArgMeasureHelper, createPercentileMeasure, createMedianMeasure, createDerivedMeasure } from './utils/base-measure-definition.js';
export { validatePercentileLevel } from './utils/base-measure-definition.js';
import { createShiftMeasure, type ShiftMeasureOptions } from './utils/shift-measure-definition.js';
import type {
  MeasureTimeInterval,
  TimeGrain,
  WindowMeasureDefinition,
  ShiftMeasureDefinition,
} from './types.js';
import { createWindowMeasure, type WindowMeasureOptions } from './utils/window-measure-definition.js';

export const measure = {
  sum: createMeasureHelper('sum'),
  count: createMeasureHelper('count'),
  countDistinct: createMeasureHelper('countDistinct'),
  /**
   * Estimated number of distinct values (ClickHouse `uniq`). Uses bounded
   * memory on high-cardinality columns; catalogs mark it `approximate`.
   */
  approxCountDistinct: createMeasureHelper('approxCountDistinct'),
  avg: createMeasureHelper('avg'),
  min: createMeasureHelper('min'),
  max: createMeasureHelper('max'),
  /** Approximate percentile of a numeric field (ClickHouse `quantile(level)`). */
  percentile: createPercentileMeasure,
  /** Median — sugar for `percentile(field, 0.5)`. */
  median: createMedianMeasure,
  /**
   * Value of `field` on the row where `by` is greatest (ClickHouse `argMax`).
   * The runtime value follows `field`'s type; aggregate result columns are
   * exposed as strings to match the dataset result contract.
   * Measure filters are not supported on argMax/argMin.
   */
  argMax: createArgMeasureHelper('argMax'),
  /** Value of `field` on the row where `by` is smallest (ClickHouse `argMin`). */
  argMin: createArgMeasureHelper('argMin'),
  /** Sample standard deviation (ClickHouse `stddevSamp`). */
  stddev: createMeasureHelper('stddev'),
  /** Sample variance (ClickHouse `varSamp`). */
  variance: createMeasureHelper('variance'),
  /** A formula over measures owned by this dataset. */
  derived: createDerivedMeasure,
  /** Evaluate a measure and its dependencies in an earlier aligned period. */
  shift: <const TMeasureName extends string>(baseMeasure: TMeasureName, interval: MeasureTimeInterval, options?: ShiftMeasureOptions): ShiftMeasureDefinition<TMeasureName> =>
    createShiftMeasure(baseMeasure, interval, options),
  /** Re-aggregate rows over a trailing interval of whole query buckets. */
  trailing: <const TMeasureName extends string>(baseMeasure: TMeasureName, interval: MeasureTimeInterval, options?: WindowMeasureOptions): WindowMeasureDefinition<TMeasureName> =>
    createWindowMeasure(baseMeasure, { trailing: { ...interval } }, options),
  /** Re-aggregate rows from the enclosing period's start through each bucket. */
  toDate: <const TMeasureName extends string>(baseMeasure: TMeasureName, grain: Exclude<TimeGrain, 'minute'>, options?: WindowMeasureOptions): WindowMeasureDefinition<TMeasureName> =>
    createWindowMeasure(baseMeasure, { toDate: grain }, options),
  /** Running sum/count/minimum/maximum over all rows through each bucket. */
  cumulative: <const TMeasureName extends string>(baseMeasure: TMeasureName, options?: WindowMeasureOptions): WindowMeasureDefinition<TMeasureName> =>
    createWindowMeasure(baseMeasure, { cumulative: true }, options),
} as const;
