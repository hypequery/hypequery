/**
 * Whether a deployment target accepts a built deployment (RFC 0030).
 *
 * Producers select versions from content and never lower them to fit a
 * target. This check only reports a mismatch, with what forced the version,
 * so the producer can refuse before upload and say why.
 */

import { datasetContract3Features, type ProtocolContract3Feature } from '../deployments/contract-3-features.js';
import type { ProtocolDeploymentContractAnyVersion } from '../deployments/types.js';
import type { ProtocolDeploymentTargetAccepts } from './accepts.js';

/** How RFC 0030 words each contract 3 feature in a refusal. */
export const PROTOCOL_CONTRACT_3_FEATURE_LABELS: Readonly<Record<ProtocolContract3Feature, string>> = Object.freeze({
  segments: 'segments',
  windowMeasures: 'window measures',
  shiftMeasures: 'shift measures',
  approxCountDistinct: 'approxCountDistinct',
  subDayDefaultGrain: 'a sub-day default grain',
  alternateTimeFields: 'alternate time keys',
});

export interface ProtocolDatasetContract3Features {
  readonly dataset: string;
  readonly features: readonly ProtocolContract3Feature[];
}

/** The datasets of `contract` that force contract 3, each with its features, in contract order. */
export function deploymentContract3Features(
  contract: ProtocolDeploymentContractAnyVersion,
): readonly ProtocolDatasetContract3Features[] {
  return Object.freeze(contract.datasets.flatMap(dataset => {
    const features = datasetContract3Features(dataset);
    return features.length > 0 ? [Object.freeze({ dataset: String(dataset.name), features })] : [];
  }));
}

export type ProtocolDeploymentTargetRefusal =
  | {
    readonly kind: 'deploymentContract';
    readonly version: number;
    readonly accepted: readonly number[];
    /** The datasets whose features forced `version`; empty for contract 2. */
    readonly forcedBy: readonly ProtocolDatasetContract3Features[];
  }
  | {
    readonly kind: 'bundle';
    readonly version: number;
    readonly accepted: readonly number[];
  };

export interface ProtocolDeploymentTargetAcceptanceInput {
  readonly contract: ProtocolDeploymentContractAnyVersion;
  /** The bundle manifest version; omit to check the contract only. */
  readonly bundleVersion?: number;
  readonly accepts: ProtocolDeploymentTargetAccepts;
}

/**
 * Everything about a built deployment that `accepts` refuses: its contract
 * version, then its bundle manifest version. Empty when the target accepts it.
 */
export function checkProtocolDeploymentTargetAcceptance(
  input: ProtocolDeploymentTargetAcceptanceInput,
): readonly ProtocolDeploymentTargetRefusal[] {
  const refusals: ProtocolDeploymentTargetRefusal[] = [];
  const contractVersion = input.contract.version;
  if (!input.accepts.deploymentContract.includes(contractVersion)) {
    refusals.push(Object.freeze({
      kind: 'deploymentContract',
      version: contractVersion,
      accepted: input.accepts.deploymentContract,
      forcedBy: deploymentContract3Features(input.contract),
    }));
  }
  if (input.bundleVersion !== undefined && !input.accepts.bundle.includes(input.bundleVersion)) {
    refusals.push(Object.freeze({
      kind: 'bundle',
      version: input.bundleVersion,
      accepted: input.accepts.bundle,
    }));
  }
  return Object.freeze(refusals);
}
