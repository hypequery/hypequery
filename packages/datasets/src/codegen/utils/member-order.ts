import type {
  ProtocolDeploymentContract,
  ProtocolDeploymentDataset,
  ProtocolDeploymentMeasure,
} from '@hypequery/protocol';

import { byName } from '../../utils/by-name.js';

/**
 * A contract with its named members in the order `dataset()` code produces
 * them: datasets, dimensions, filters and relationships by name, and base
 * measures by name followed by derived measures by name.
 *
 * Code can't keep any other order, because `protocol-adapter.ts` sorts every
 * member list, so nothing in a contract depends on it. Cloud's editor appends
 * members as they're added, so exporting a Cloud model gives code whose
 * contract equals this, not always the input byte for byte. Order inside a
 * member (filter operators, relationship keys, `uses`, `defaults`) is kept.
 */
export function canonicalMemberOrder(contract: ProtocolDeploymentContract): ProtocolDeploymentContract {
  const named = <T extends { readonly name: unknown }>(items: readonly T[]): T[] =>
    [...items].sort((left, right) => byName({ name: String(left.name) }, { name: String(right.name) }));
  const isDerived = (measure: ProtocolDeploymentMeasure) => 'kind' in measure && measure.kind === 'derived';
  return {
    ...contract,
    datasets: named(contract.datasets).map((dataset): ProtocolDeploymentDataset => ({
      ...dataset,
      dimensions: named(dataset.dimensions),
      measures: [
        ...named(dataset.measures.filter(measure => !isDerived(measure))),
        ...named(dataset.measures.filter(isDerived)),
      ],
      filters: named(dataset.filters),
      relationships: named(dataset.relationships),
    })),
  };
}
