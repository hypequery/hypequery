import { isProtocolAggregateStateFunction, type ProtocolAggregateStateFunction } from '@hypequery/protocol';
import { matchTypeCall } from './clickhouse-type-utils.js';

/**
 * How a pre-aggregated column must be read, from its ClickHouse type.
 *
 * - `state`: an `AggregateFunction(fn, …)` column holding partial states, read
 *   with the `-Merge` combinator. `stateFunction` is set only when a `merge`
 *   measure can finalize it (non-parametric, allowlisted).
 * - `simple`: a `SimpleAggregateFunction(fn, T)` column, read with `fn` itself.
 */
export type AggregateColumn =
  | { readonly kind: 'state'; readonly function: string; readonly stateFunction?: ProtocolAggregateStateFunction }
  | { readonly kind: 'simple'; readonly function: string };

export function aggregateColumnOf(type: string): AggregateColumn | null {
  const trimmed = type.trim();
  const state = matchTypeCall(trimmed, 'AggregateFunction');
  if (state?.length) {
    const fn = state[0]!.trim();
    return isProtocolAggregateStateFunction(fn)
      ? { kind: 'state', function: fn, stateFunction: fn }
      : { kind: 'state', function: fn };
  }
  const simple = matchTypeCall(trimmed, 'SimpleAggregateFunction');
  if (simple?.length) return { kind: 'simple', function: simple[0]!.trim() };
  return null;
}
