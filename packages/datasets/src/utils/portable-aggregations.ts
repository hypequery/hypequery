/**
 * Aggregations that the published deployment contract can carry.
 *
 * `approxCountDistinct` runs locally, but it is an expression extension 2 and
 * deployment contract 3 feature (RFC 0015). Publishing emits contract 2 until
 * it can emit contract 3, so it refuses the measure with an error naming it.
 */

import type { ProtocolAggregation } from '@hypequery/protocol';
import type { AggregationType } from '../types.js';

type PortableAggregation = Exclude<ProtocolAggregation, 'approxCountDistinct'>;

/** Returns `aggregation` when publishing can carry it; otherwise throws naming `owner`. */
export function requirePortableAggregation(
  aggregation: AggregationType,
  owner: string,
): PortableAggregation {
  if (aggregation === 'approxCountDistinct') {
    throw new Error(
      `${owner} uses approxCountDistinct, which cannot be published yet: approximate aggregations ` +
      'need deployment contract 3 (RFC 0015). Use it for local queries, or publish countDistinct instead.',
    );
  }
  return aggregation;
}
