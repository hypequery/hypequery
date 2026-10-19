import type { ProtocolClientContract } from '@hypequery/protocol';

export function clientDatasetNames(contract: ProtocolClientContract): string[] {
  return [...new Set(contract.endpoints.map(endpoint => endpoint.dataset))].sort();
}

/** Preserve endpoint-specific permissions instead of merging them into a synthetic dataset. */
export function clientDatasetProfile(contract: ProtocolClientContract, dataset: string): Record<string, unknown> {
  const endpoints = contract.endpoints.filter(endpoint => endpoint.dataset === dataset);
  return {
    name: dataset, queryable: endpoints.some(endpoint => endpoint.kind === 'dataset'),
    endpoints: endpoints.map(({ path: _path, schemaHash: _hash, ...profile }) => profile),
  };
}

export function clientDatasetList(contract: ProtocolClientContract): Record<string, unknown> {
  const datasets = clientDatasetNames(contract).map(name => {
    const endpoints = contract.endpoints.filter(endpoint => endpoint.dataset === name);
    return {
      name, description: 'Authorized client endpoints.',
      queryable: endpoints.some(endpoint => endpoint.kind === 'dataset'),
      dimensionCount: new Set(endpoints.flatMap(endpoint => Object.keys(endpoint.dimensions))).size,
      measureCount: new Set(endpoints.flatMap(endpoint => Object.keys(endpoint.measures))).size,
      metricCount: endpoints.filter(endpoint => endpoint.kind === 'metric').length,
    };
  });
  return { datasets, total: datasets.length };
}
