import {
  validateProtocolDatasetOnlyContract,
  type ProtocolDatasetOnlyContract,
  type ProtocolDatasetOnlyDataset,
  type ProtocolEndpointPolicy,
} from '@hypequery/protocol';
import type { AnyDatasetInstance } from './types.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { derivedMeasureExpression } from './utils/protocol-metric-expressions.js';
import { toProtocolSemanticMetadata } from './utils/protocol-semantic-metadata.js';

export interface BuildDatasetOnlyContractOptions {
  readonly endpoints?: Readonly<Record<string, ProtocolEndpointPolicy>>;
}

/** Build the new Cloud wire; local metrics are intentionally never copied. */
export function buildProtocolDatasetOnlyContract(
  datasets: readonly AnyDatasetInstance[],
  options: BuildDatasetOnlyContractOptions = {},
): ProtocolDatasetOnlyContract {
  const contracts: ProtocolDatasetOnlyDataset[] = datasets.map(dataset => {
    const legacy = buildProtocolDatasetContract(dataset, {
      endpoint: options.endpoints?.[dataset.name],
    });
    const { metrics: _metrics, ...base } = legacy;
    const derived = Object.entries(dataset.derivedMeasures ?? {}).map(([name, definition]) => ({
      kind: 'derived' as const,
      name,
      uses: Object.entries(definition.uses).map(([alias, measure]) => ({ alias, measure })),
      expression: derivedMeasureExpression(definition),
      ...(definition.label !== undefined ? { label: definition.label } : {}),
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      ...toProtocolSemanticMetadata(definition),
    }));
    return { ...base, measures: [...base.measures, ...derived] } as ProtocolDatasetOnlyDataset;
  });
  return validateProtocolDatasetOnlyContract({
    kind: 'hypequery-deployment',
    version: 2,
    datasets: contracts,
  });
}
