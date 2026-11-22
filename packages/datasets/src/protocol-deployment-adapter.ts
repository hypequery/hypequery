import { byName } from './utils/by-name.js';
import { splitDatasetMeasures } from './utils/dataset-measures.js';
import { assertDeployable } from './utils/deployable-formulas.js';
import {
  parseProtocolIdentifier,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentContractV3,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentContractAnyVersion,
  type ProtocolDeploymentContractV3,
  type ProtocolDeploymentDataset,
  type ProtocolEndpointPolicy,
} from '@hypequery/protocol';
import type { AnyDatasetInstance } from './types.js';
import { buildProtocolDatasetContract, protocolDatasetRecord } from './protocol-adapter.js';
import { derivedMeasureExpression } from './utils/protocol-metric-expressions.js';
import { toProtocolSemanticMetadata } from './utils/protocol-semantic-metadata.js';
import {
  derivedApproximateMarker,
  protocolSegments,
  protocolTimeMeasures,
  usesContract3Features,
} from './utils/protocol-contract-3.js';

export interface BuildProtocolDeploymentContractOptions {
  readonly endpoints?: Readonly<Record<string, ProtocolEndpointPolicy>>;
}

function derivedMeasures(dataset: AnyDatasetInstance, contractVersion: 2 | 3) {
  return Object.entries(splitDatasetMeasures(dataset.measures).derived).map(([name, definition]) => ({
    kind: 'derived' as const,
    name: parseProtocolIdentifier(name),
    uses: Object.entries(definition.uses).map(([alias, measure]) => ({
      alias: parseProtocolIdentifier(alias),
      measure: parseProtocolIdentifier(measure),
    })),
    expression: derivedMeasureExpression(definition),
    ...(contractVersion === 3 ? derivedApproximateMarker(dataset, name) : {}),
    ...(definition.label !== undefined ? { label: definition.label } : {}),
    ...(definition.description !== undefined ? { description: definition.description } : {}),
    ...toProtocolSemanticMetadata(definition),
  }));
}

function contract2Dataset(
  dataset: AnyDatasetInstance,
  endpoint: ProtocolEndpointPolicy | undefined,
): ProtocolDeploymentDataset {
  const contract = buildProtocolDatasetContract(dataset, { endpoint });
  const { metrics: _metrics, ...base } = contract;
  return { ...base, measures: [...base.measures, ...derivedMeasures(dataset, 2)] } satisfies ProtocolDeploymentDataset;
}

/**
 * A contract 3 dataset: base measures sorted by name, then window and shift
 * measures and then derived measures, each in declaration order. The filter
 * allow-list is `allowedFilters`, and `segments` is present only when declared.
 */
function contract3Dataset(
  dataset: AnyDatasetInstance,
  endpoint: ProtocolEndpointPolicy | undefined,
): Record<string, unknown> {
  const { metrics: _metrics, filters, ...base } = protocolDatasetRecord(dataset, { endpoint }, 3);
  const segments = protocolSegments(dataset);
  return {
    ...base,
    measures: [...base.measures, ...protocolTimeMeasures(dataset), ...derivedMeasures(dataset, 3)],
    allowedFilters: filters,
    ...(segments.length > 0 ? { segments } : {}),
    // RFC 0029: alternate time axes, in authored order.
    ...((dataset.timeKeys?.length ?? 0) > 0 ? { alternateTimeFields: [...dataset.timeKeys!] } : {}),
  };
}

/**
 * Build the deployment contract; local metrics are not carried.
 *
 * The version follows RFC 0015's lowest-version rule. A deployment is contract
 * 2 unless a dataset uses segments, window or shift measures, alternate time keys,
 * `approxCountDistinct`, or a sub-day default grain, so a deployment that uses
 * none keeps the bytes and identity it had before contract 3.
 */
export function buildProtocolDeploymentContract(
  datasets: readonly AnyDatasetInstance[],
  options: BuildProtocolDeploymentContractOptions = {},
): ProtocolDeploymentContractAnyVersion {
  // Sorted, as Python's builder does: the contract's identity must not depend
  // on the order the datasets were passed in.
  const sorted = [...datasets].sort(byName);
  // Name the dataset and measure before the contract grammar can only name a path.
  sorted.forEach(assertDeployable);
  if (!sorted.some(usesContract3Features)) {
    return validateProtocolDeploymentContract({
      kind: 'hypequery-deployment',
      version: 2,
      datasets: sorted.map(dataset => contract2Dataset(dataset, options.endpoints?.[dataset.name])),
    }) satisfies ProtocolDeploymentContract;
  }
  return validateProtocolDeploymentContractV3({
    kind: 'hypequery-deployment',
    version: 3,
    datasets: sorted.map(dataset => contract3Dataset(dataset, options.endpoints?.[dataset.name])),
  }) satisfies ProtocolDeploymentContractV3;
}
