import type { ProtocolDeploymentDatasetAnyVersion, ProtocolDeploymentDatasetV3 } from './types.js';

/**
 * What forces a dataset's deployment to contract 3 (RFC 0015, RFC 0029), in
 * the registry order RFC 0030 fixes. The `allowedFilters` rename is not one:
 * on its own it never raises the version.
 */
export type ProtocolContract3Feature =
  | 'segments'
  | 'windowMeasures'
  | 'shiftMeasures'
  | 'approxCountDistinct'
  | 'subDayDefaultGrain'
  | 'alternateTimeFields';

/** Registry order, which every message and fixture follows. */
export const PROTOCOL_CONTRACT_3_FEATURES: readonly ProtocolContract3Feature[] = Object.freeze([
  'segments',
  'windowMeasures',
  'shiftMeasures',
  'approxCountDistinct',
  'subDayDefaultGrain',
  'alternateTimeFields',
]);

/**
 * The contract 3 features a contract dataset uses, in registry order. Derived
 * from the contract alone, so a deployment target and the CLI that built the
 * bundle name the same features. A contract 2 dataset uses none.
 */
export function datasetContract3Features(
  dataset: ProtocolDeploymentDatasetAnyVersion,
): readonly ProtocolContract3Feature[] {
  const v3 = dataset as Partial<ProtocolDeploymentDatasetV3>;
  const measures = dataset.measures as readonly { readonly kind?: string; readonly aggregation?: string }[];
  const grain = (dataset.defaults as { readonly timeGrain?: string } | undefined)?.timeGrain;
  const used: Record<ProtocolContract3Feature, boolean> = {
    segments: (v3.segments?.length ?? 0) > 0,
    windowMeasures: measures.some(measure => measure.kind === 'window'),
    shiftMeasures: measures.some(measure => measure.kind === 'shift'),
    approxCountDistinct: measures.some(measure => measure.aggregation === 'approxCountDistinct'),
    subDayDefaultGrain: grain === 'minute' || grain === 'hour',
    alternateTimeFields: (v3.alternateTimeFields?.length ?? 0) > 0,
  };
  return Object.freeze(PROTOCOL_CONTRACT_3_FEATURES.filter(feature => used[feature]));
}
