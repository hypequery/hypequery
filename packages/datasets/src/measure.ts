import type { MeasureDefinition, MeasureOptions, MeasureAggregation } from './types.js';

function createMeasureHelper(aggregation: MeasureAggregation) {
  return (field: string, opts?: MeasureOptions): MeasureDefinition => ({
    __type: 'measure_definition',
    aggregation,
    field,
    sql: opts?.sql,
    label: opts?.label,
    description: opts?.description,
    filters: opts?.filters,
  });
}

export function validatePercentileLevel(level: number): void {
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) {
    throw new Error(`Invalid percentile level ${level}: expected a number between 0 and 1.`);
  }
}

function createArgMeasureHelper(aggregation: 'argMax' | 'argMin') {
  return (field: string, by: string, opts?: Omit<MeasureOptions, 'filters'>): MeasureDefinition => {
    if (!by) {
      throw new Error(`measure.${aggregation}("${field}", by) requires a "by" field.`);
    }
    return {
      __type: 'measure_definition',
      aggregation,
      field,
      argField: by,
      sql: opts?.sql,
      label: opts?.label,
      description: opts?.description,
    };
  };
}

function createPercentileMeasure(field: string, level: number, opts?: MeasureOptions): MeasureDefinition {
  validatePercentileLevel(level);
  return {
    __type: 'measure_definition',
    aggregation: 'percentile',
    field,
    level,
    sql: opts?.sql,
    label: opts?.label,
    description: opts?.description,
    filters: opts?.filters,
  };
}

export const measure = {
  sum: createMeasureHelper('sum'),
  count: createMeasureHelper('count'),
  countDistinct: createMeasureHelper('countDistinct'),
  avg: createMeasureHelper('avg'),
  min: createMeasureHelper('min'),
  max: createMeasureHelper('max'),
  /** Approximate percentile of a numeric field (ClickHouse `quantile(level)`). */
  percentile: createPercentileMeasure,
  /** Median — sugar for `percentile(field, 0.5)`. */
  median: (field: string, opts?: MeasureOptions): MeasureDefinition =>
    createPercentileMeasure(field, 0.5, opts),
  /**
   * Value of `field` on the row where `by` is greatest (ClickHouse `argMax`).
   * The runtime value follows `field`'s type; static row typing stays `number`.
   * Measure filters are not supported on argMax/argMin.
   */
  argMax: createArgMeasureHelper('argMax'),
  /** Value of `field` on the row where `by` is smallest (ClickHouse `argMin`). */
  argMin: createArgMeasureHelper('argMin'),
  /** Sample standard deviation (ClickHouse `stddevSamp`). */
  stddev: createMeasureHelper('stddev'),
  /** Sample variance (ClickHouse `varSamp`). */
  variance: createMeasureHelper('variance'),
} as const;
