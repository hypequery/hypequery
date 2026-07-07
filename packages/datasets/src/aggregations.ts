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
