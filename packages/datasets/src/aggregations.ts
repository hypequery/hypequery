/**
 * Aggregation helpers — return AggregationSpec objects used in metric definitions.
 *
 * @example
 * ```ts
 * import { sum, count, countDistinct, avg } from '@hypequery/serve';
 *
 * const totalRevenue = Orders.metric("totalRevenue", {
 *   value: sum("amount"),
 * });
 *
 * const orderCount = Orders.metric("orderCount", {
 *   value: count("id"),
 * });
 * ```
 */

import type { AggregationSpec, AggregationType } from './types.js';
import { validatePercentileLevel } from './measure.js';

function createAggregation(aggregation: AggregationType, field: string): AggregationSpec {
  return {
    __type: 'aggregation_spec',
    aggregation,
    field,
  };
}

export function sum(field: string): AggregationSpec {
  return createAggregation('sum', field);
}

export function count(field: string): AggregationSpec {
  return createAggregation('count', field);
}

export function countDistinct(field: string): AggregationSpec {
  return createAggregation('countDistinct', field);
}

export function avg(field: string): AggregationSpec {
  return createAggregation('avg', field);
}

export function min(field: string): AggregationSpec {
  return createAggregation('min', field);
}

export function max(field: string): AggregationSpec {
  return createAggregation('max', field);
}

/** Approximate percentile of a numeric field at `level` in [0, 1]. */
export function percentile(field: string, level: number): AggregationSpec {
  validatePercentileLevel(level);
  return { ...createAggregation('percentile', field), level };
}

/** Median — sugar for `percentile(field, 0.5)`. */
export function median(field: string): AggregationSpec {
  return percentile(field, 0.5);
}

/** Value of `field` on the row where `by` is greatest. */
export function argMax(field: string, by: string): AggregationSpec {
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new Error('argMax(field, by) requires a "by" field.');
  }
  return { ...createAggregation('argMax', field), argField: by };
}

/** Value of `field` on the row where `by` is smallest. */
export function argMin(field: string, by: string): AggregationSpec {
  if (typeof by !== 'string' || by.trim().length === 0) {
    throw new Error('argMin(field, by) requires a "by" field.');
  }
  return { ...createAggregation('argMin', field), argField: by };
}

/** Sample standard deviation. */
export function stddev(field: string): AggregationSpec {
  return createAggregation('stddev', field);
}

/** Sample variance. */
export function variance(field: string): AggregationSpec {
  return createAggregation('variance', field);
}
