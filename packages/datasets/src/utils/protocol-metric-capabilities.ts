import type { ProtocolDatasetMetric } from '@hypequery/protocol';
import type { MetricHandle, MetricQuery, MetricRef, TimeGrain } from '../types.js';

const CAPABILITIES = Symbol('hypequery.protocol-metric-capabilities');
interface Capabilities {
  readonly dimensions: readonly string[];
  readonly filters: readonly string[];
  readonly grains: readonly TimeGrain[];
}
type RestrictedHandle = MetricHandle & { readonly [CAPABILITIES]?: Capabilities };

/** Runtime restrictions travel with a cloned handle, including publication aliases. */
export function protocolMetricCapabilityErrors(handle: MetricHandle, query: MetricQuery): string[] {
  const capabilities = (handle as RestrictedHandle)[CAPABILITIES];
  if (!capabilities) return [];
  const errors: string[] = [];
  for (const dimension of query.dimensions ?? []) {
    if (!capabilities.dimensions.includes(dimension)) errors.push(`Dimension "${dimension}" is not published for this metric.`);
  }
  for (const filter of query.filters ?? []) {
    if (!capabilities.filters.includes(filter.field)) errors.push(`Filter "${filter.field}" is not published for this metric.`);
  }
  const grain = handle.__type === 'grained_metric_ref' ? handle.grain : query.by;
  if (grain && !capabilities.grains.includes(grain)) errors.push(`Grain "${grain}" is not published for this metric.`);
  return errors;
}

/** Pin discovery and execution together, preserving restrictions when graining. */
export function withContractCapabilities(handle: MetricHandle, metric: ProtocolDatasetMetric): MetricHandle {
  const capabilities: Capabilities = Object.freeze({
    dimensions: Object.freeze(metric.dimensions.map(String)),
    filters: Object.freeze(metric.filters.map(String)),
    grains: Object.freeze([...metric.grains] as TimeGrain[]),
  });
  const pin = (target: MetricHandle): MetricHandle => {
    const contract = () => ({
      ...target.contract(),
      dimensions: [...capabilities.dimensions],
      filters: [...capabilities.filters],
      grains: [...capabilities.grains],
    });
    if (target.__type === 'grained_metric_ref') {
      return Object.freeze({ ...target, [CAPABILITIES]: capabilities, metric: pin(target.metric) as MetricRef, contract });
    }
    const pinned: MetricRef & { [CAPABILITIES]: Capabilities } = {
      ...target,
      [CAPABILITIES]: capabilities,
      contract,
      by(grain) {
        if (!capabilities.grains.includes(grain)) throw new Error(`Grain "${grain}" is not published for this metric.`);
        const grained = target.by(grain);
        return Object.freeze({
          ...grained,
          [CAPABILITIES]: capabilities,
          metric: pinned,
          contract: () => ({ ...contract(), kind: 'grained_metric' as const, grain }),
        });
      },
    };
    return Object.freeze(pinned);
  };
  return pin(handle);
}
