import { buildDatasetClientContract, type DatasetClientEndpoint } from '@hypequery/datasets';
import type { ProtocolClientContract } from '@hypequery/protocol';

/**
 * A dataset or metric endpoint's place in the API's client contract. It is
 * resolved lazily, so an API that never exports or pins a contract never
 * builds one, and at the path `api.manifest()` names, which `api.route()`
 * may change after the API is created.
 */
export interface ClientEndpointBinding {
  /**
   * The endpoint as the client contract describes it, or `undefined` when
   * the contract cannot advertise it (a metric with a fixed grain). Throws
   * when the endpoint is misconfigured for export.
   */
  definition(): DatasetClientEndpoint | undefined;
  /** A one-endpoint contract at the binding's current path, under its mount path. */
  contract(): ProtocolClientContract | undefined;
  /** The trusted mount path every contract path starts with. */
  readonly mountPath: string;
}

export function createClientEndpointBinding(
  mountPath: string,
  resolve: () => DatasetClientEndpoint | undefined,
): ClientEndpointBinding {
  // One entry per exported path: it changes only when `api.route()` moves the endpoint.
  const contracts = new Map<string, ProtocolClientContract>();
  return {
    mountPath,
    definition: resolve,
    contract() {
      const definition = resolve();
      if (definition === undefined) return undefined;
      let contract = contracts.get(definition.path);
      if (contract === undefined) {
        contract = buildDatasetClientContract([definition], { mountPath }).contract;
        contracts.set(definition.path, contract);
      }
      return contract;
    },
  };
}
