import type { ProtocolClientContract, ProtocolClientEndpoint } from '@hypequery/protocol';

const GENERIC_DESCRIPTION = 'Authorized client endpoints.';

export function clientDatasetNames(contract: ProtocolClientContract): string[] {
  return [...new Set(contract.endpoints.map(endpoint => endpoint.dataset))].sort();
}

/** Group text from the dataset endpoint when visible, else any endpoint of the group (id order). */
function groupText(endpoints: readonly ProtocolClientEndpoint[], key: 'label' | 'description'): string | undefined {
  const ordered = [...endpoints.filter(endpoint => endpoint.kind === 'dataset'), ...endpoints.filter(endpoint => endpoint.kind === 'metric')];
  return ordered.find(endpoint => endpoint.annotations?.[key] !== undefined)?.annotations?.[key];
}

/** Preserve endpoint-specific permissions instead of merging them into a synthetic dataset. */
export function clientDatasetProfile(contract: ProtocolClientContract, dataset: string): Record<string, unknown> {
  const endpoints = contract.endpoints.filter(endpoint => endpoint.dataset === dataset);
  const label = groupText(endpoints, 'label'), description = groupText(endpoints, 'description');
  return {
    name: dataset, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }),
    queryable: endpoints.some(endpoint => endpoint.kind === 'dataset'),
    endpoints: endpoints.map(({ path: _path, schemaHash: _hash, ...profile }) => profile),
  };
}

export function clientDatasetList(contract: ProtocolClientContract): Record<string, unknown> {
  const datasets = clientDatasetNames(contract).map(name => {
    const endpoints = contract.endpoints.filter(endpoint => endpoint.dataset === name);
    const label = groupText(endpoints, 'label');
    return {
      name, ...(label === undefined ? {} : { label }),
      description: groupText(endpoints, 'description') ?? GENERIC_DESCRIPTION,
      queryable: endpoints.some(endpoint => endpoint.kind === 'dataset'),
      dimensionCount: new Set(endpoints.flatMap(endpoint => Object.keys(endpoint.dimensions))).size,
      measureCount: new Set(endpoints.flatMap(endpoint => Object.keys(endpoint.measures))).size,
      metricCount: endpoints.filter(endpoint => endpoint.kind === 'metric').length,
    };
  });
  return { datasets, total: datasets.length };
}
