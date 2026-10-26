/**
 * Aggregate functions whose stored states a `merge` measure can finalize.
 *
 * An `AggregatingMergeTree` table stores partial aggregation states in
 * `AggregateFunction(<fn>, <type>)` columns. Reading one needs the matching
 * `-Merge` combinator (`uniqMerge(users)`); a plain `sum` or `count` over the
 * state column is a type error or a meaningless number.
 *
 * Only non-parametric functions are listed: a parametric state such as
 * `quantile(0.9)` must be merged with the same parameters, which a measure
 * cannot read back from the column type. The name is interpolated into SQL, so
 * it must come from this list.
 */

import type { MeasureDefinition } from '../types.js';

export const AGGREGATE_STATE_FUNCTIONS = [
  'uniq',
  'uniqExact',
  'uniqCombined',
  'uniqCombined64',
  'uniqHLL12',
  'uniqTheta',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'any',
  'anyLast',
  'groupBitmap',
] as const;

export type AggregateStateFunction = (typeof AGGREGATE_STATE_FUNCTIONS)[number];

const STATE_FUNCTIONS: ReadonlySet<string> = new Set(AGGREGATE_STATE_FUNCTIONS);

/** States whose merged value is an estimate. */
const APPROXIMATE_STATE_FUNCTIONS: ReadonlySet<string> = new Set([
  'uniq', 'uniqCombined', 'uniqCombined64', 'uniqHLL12', 'uniqTheta',
]);

/** States whose merged value is a count: 0, not NULL, over an empty population. */
const COUNT_STATE_FUNCTIONS: ReadonlySet<string> = new Set([
  'uniq', 'uniqExact', 'uniqCombined', 'uniqCombined64', 'uniqHLL12', 'uniqTheta', 'count', 'groupBitmap',
]);

export function isAggregateStateFunction(value: unknown): value is AggregateStateFunction {
  return typeof value === 'string' && STATE_FUNCTIONS.has(value);
}

/** Throws unless `value` is a supported state function; `owner` names the measure. */
export function assertAggregateStateFunction(value: unknown, owner: string): asserts value is AggregateStateFunction {
  if (!isAggregateStateFunction(value)) {
    throw new Error(
      `${owner} merges an unsupported aggregate state "${String(value)}". ` +
      `Supported state functions: ${AGGREGATE_STATE_FUNCTIONS.join(', ')}.`,
    );
  }
}

/** ClickHouse `-Merge` call that finalizes the states in `column`. */
export function mergeStateExpression(stateFunction: AggregateStateFunction, column: string): string {
  return `${stateFunction}Merge(${column})`;
}

export function isApproximateStateFunction(stateFunction: string | undefined): boolean {
  return stateFunction !== undefined && APPROXIMATE_STATE_FUNCTIONS.has(stateFunction);
}

export function isCountStateMerge(definition: Pick<MeasureDefinition, 'aggregation' | 'stateFunction'>): boolean {
  return definition.aggregation === 'merge'
    && definition.stateFunction !== undefined
    && COUNT_STATE_FUNCTIONS.has(definition.stateFunction);
}
