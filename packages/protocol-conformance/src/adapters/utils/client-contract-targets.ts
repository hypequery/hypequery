import type { ProtocolClientContract } from '@hypequery/protocol';

/** Callable targets, preserving normalized endpoint order without inventing dataset access. */
export function clientContractTargets(contract: ProtocolClientContract): Record<string, unknown> {
  return {
    queryDatasetTargets: contract.endpoints.filter(e => e.kind === 'dataset').map(e => e.id),
    queryMetricTargets: contract.endpoints.filter(e => e.kind === 'metric').map(e => ({ dataset: e.dataset, metric: e.id })),
  };
}
