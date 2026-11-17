/**
 * Aggregations that the published deployment contract can carry.
 *
 * `approxCountDistinct` is an expression extension 2 and deployment contract 3
 * feature (RFC 0015). A deployment carries it as a contract 3 measure; the
 * standalone dataset contract and published metrics stay on contract 2 and
 * refuse it with an error naming it.
 * `merge` is a deployment measure with its state function (RFC 0022), but the
 * expression grammar has no merge aggregate, so a metric over one is refused.
 */

import type { ProtocolAggregation, ProtocolDatasetMeasureV3 } from '@hypequery/protocol';
import type { AggregationType } from '../types.js';

type PortableAggregation = Exclude<ProtocolAggregation, 'approxCountDistinct'>;

function refuseApproximate(
  aggregation: AggregationType,
  owner: string,
): asserts aggregation is Exclude<AggregationType, 'approxCountDistinct'> {
  if (aggregation === 'approxCountDistinct') {
    throw new Error(
      `${owner} uses approxCountDistinct, which cannot be published here: approximate aggregations ` +
      'need deployment contract 3 (RFC 0015). Publish it as a dataset measure, or use countDistinct here.',
    );
  }
}

/**
 * A dataset measure's aggregation as the contract carries it; otherwise throws
 * naming `owner`. Contract 3 carries `approxCountDistinct`; contract 2 does not.
 */
export function requirePublishableMeasureAggregation(
  aggregation: AggregationType,
  owner: string,
  contractVersion: 2 | 3 = 2,
): ProtocolDatasetMeasureV3['aggregation'] {
  if (contractVersion === 2) refuseApproximate(aggregation, owner);
  return aggregation as ProtocolDatasetMeasureV3['aggregation'];
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
