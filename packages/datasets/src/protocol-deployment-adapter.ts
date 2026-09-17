import {
  parseProtocolIdentifier,
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentDataset,
  type ProtocolEndpointPolicy,
} from '@hypequery/protocol';
import type { AnyDatasetInstance } from './types.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { derivedMeasureExpression } from './utils/protocol-metric-expressions.js';
import { toProtocolSemanticMetadata } from './utils/protocol-semantic-metadata.js';

export interface BuildProtocolDeploymentContractOptions {
  readonly endpoints?: Readonly<Record<string, ProtocolEndpointPolicy>>;
}

/** Build the deployment contract; local metrics are not carried. */
export function buildProtocolDeploymentContract(
  datasets: readonly AnyDatasetInstance[],
  options: BuildProtocolDeploymentContractOptions = {},
): ProtocolDeploymentContract {
  const contracts: ProtocolDeploymentDataset[] = datasets.map(dataset => {
    const contract = buildProtocolDatasetContract(dataset, {
      endpoint: options.endpoints?.[dataset.name],
    });
    const { metrics: _metrics, ...base } = contract;
    const derived = Object.entries(dataset.derivedMeasures ?? {}).map(([name, definition]) => ({
      kind: 'derived' as const,
      name: parseProtocolIdentifier(name),
      uses: Object.entries(definition.uses).map(([alias, measure]) => ({
        alias: parseProtocolIdentifier(alias),
        measure: parseProtocolIdentifier(measure),
      })),
      expression: derivedMeasureExpression(definition),
      ...(definition.label !== undefined ? { label: definition.label } : {}),
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      ...toProtocolSemanticMetadata(definition),
    }));
    return { ...base, measures: [...base.measures, ...derived] } satisfies ProtocolDeploymentDataset;
  });
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 2,
    datasets: contracts,
  });
}
