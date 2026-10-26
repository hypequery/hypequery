import { byName } from './utils/by-name.js';
import { splitDatasetMeasures } from './utils/dataset-measures.js';
import { assertDeployable } from './utils/deployable-formulas.js';
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
  // Sorted, as Python's builder does: the contract's identity must not depend
  // on the order the datasets were passed in.
  const contracts: ProtocolDeploymentDataset[] = [...datasets].sort(byName).map(dataset => {
    // Name the dataset and measure before the contract grammar can only name a path.
    assertDeployable(dataset);
    const contract = buildProtocolDatasetContract(dataset, {
      endpoint: options.endpoints?.[dataset.name],
    });
    const { metrics: _metrics, ...base } = contract;
    const derived = Object.entries(splitDatasetMeasures(dataset.measures).derived).map(([name, definition]) => ({
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
