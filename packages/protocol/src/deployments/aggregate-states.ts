/**
 * Aggregate functions whose stored states a `merge` measure finalizes (RFC 0022).
 *
 * An `AggregatingMergeTree` column `AggregateFunction(<fn>, <type>)` holds
 * partial states, read with the matching `-Merge` combinator (`uniqMerge`).
 * Only non-parametric functions: a parametric state such as `quantile(0.9)`
 * must be merged with its parameters, which a measure can't read back. The
 * name is interpolated into SQL, so it must come from this list.
 */
export const PROTOCOL_AGGREGATE_STATE_FUNCTIONS = Object.freeze([
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
] as const);

export type ProtocolAggregateStateFunction = (typeof PROTOCOL_AGGREGATE_STATE_FUNCTIONS)[number];

/** States whose merged value is an estimate: their measures are approximate. */
export const PROTOCOL_APPROXIMATE_STATE_FUNCTIONS = Object.freeze([
  'uniq',
  'uniqCombined',
  'uniqCombined64',
  'uniqHLL12',
  'uniqTheta',
] as const);

const STATE_FUNCTIONS: ReadonlySet<string> = new Set(PROTOCOL_AGGREGATE_STATE_FUNCTIONS);
const APPROXIMATE: ReadonlySet<string> = new Set(PROTOCOL_APPROXIMATE_STATE_FUNCTIONS);

export function isProtocolAggregateStateFunction(value: unknown): value is ProtocolAggregateStateFunction {
  return typeof value === 'string' && STATE_FUNCTIONS.has(value);
}

export function isApproximateStateFunction(value: string): boolean {
  return APPROXIMATE.has(value);
}
