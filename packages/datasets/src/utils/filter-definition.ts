import type { MetricFilter, MetricFilterOperator } from '../types.js';

export function createFilter<
  const TField extends string,
  const TValue,
  TOperator extends MetricFilterOperator,
>(field: TField, operator: TOperator, value: TValue): MetricFilter<TField, TValue, TOperator> {
  return { field, operator, value };
}
