/**
 * Aggregations that the published deployment contract can carry.
 *
 * `approxCountDistinct` runs locally, but it is an expression extension 2 and
 * deployment contract 3 feature (RFC 0015). Publishing emits contract 2 until
 * it can emit contract 3, so it refuses the measure with an error naming it.
 * `merge` is a deployment measure with its state function (RFC 0022), but the
 * expression grammar has no merge aggregate, so a metric over one is refused.
 */

import type { ProtocolAggregation, ProtocolDatasetMeasure } from '@hypequery/protocol';
import type { AggregationType } from '../types.js';

type PortableAggregation = Exclude<ProtocolAggregation, 'approxCountDistinct'>;

function refuseApproximate(
  aggregation: AggregationType,
  owner: string,
): asserts aggregation is Exclude<AggregationType, 'approxCountDistinct'> {
  if (aggregation === 'approxCountDistinct') {
    throw new Error(
      `${owner} uses approxCountDistinct, which cannot be published yet: approximate aggregations ` +
      'need deployment contract 3 (RFC 0015). Use it for local queries, or publish countDistinct instead.',
    );
  }
}

/** A dataset measure's aggregation as the contract carries it; otherwise throws naming `owner`. */
export function requirePublishableMeasureAggregation(
  aggregation: AggregationType,
  owner: string,
): ProtocolDatasetMeasure['aggregation'] {
  refuseApproximate(aggregation, owner);
  return aggregation as ProtocolDatasetMeasure['aggregation'];
}

/** Returns `aggregation` when an expression can carry it; otherwise throws naming `owner`. */
export function requirePortableAggregation(
  aggregation: AggregationType,
  owner: string,
): PortableAggregation {
  if (aggregation === 'merge') {
    throw new Error(
      `${owner} uses merge, which a published metric cannot express: the expression grammar has no ` +
      'aggregate-state merge. Publish the merge measure itself and query it, or use it for local queries only.',
    );
  }
  refuseApproximate(aggregation, owner);
  return aggregation;
}
