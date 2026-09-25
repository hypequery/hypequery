import { type ProtocolDeploymentContract, type ProtocolEndpointPolicy } from '@hypequery/protocol';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import type { AnyDatasetInstance } from './types.js';
import { collectCloudDatasets } from './utils/collect-cloud-datasets.js';

export interface CloudPublishingOptions {
  /** Datasets exposed to Cloud. Relationships are included as supporting datasets. */
  readonly datasets: Readonly<Record<string, AnyDatasetInstance>>;
  /** Explicit policy for every published dataset unless overridden below. */
  readonly access: {
    readonly roles: readonly string[];
    readonly scopes: readonly string[];
  };
  /** Optional stricter or different policy by published dataset name. */
  readonly datasetAccess?: Readonly<Record<string, {
    readonly roles: readonly string[];
    readonly scopes: readonly string[];
  }>>;
}

/**
 * Declare the dataset-only contract uploaded by `hypequery deploy`.
 * This function performs no network request and requires no Serve API.
 * Export its result as `cloud` from the deployment entrypoint.
 */
export function publishToCloud(options: CloudPublishingOptions): ProtocolDeploymentContract {
  const entries = Object.entries(options.datasets);
  if (entries.length === 0) throw new Error('Cloud publishing requires at least one dataset.');
  if (!options.access || !Array.isArray(options.access.roles)
    || !Array.isArray(options.access.scopes)) {
    throw new Error('Cloud publishing requires an explicit authenticated access policy.');
  }

  const datasets = new Map<string, AnyDatasetInstance>();
  const exposed = new Set<string>();
  for (const [, dataset] of entries) {
    collectCloudDatasets(datasets, dataset);
    exposed.add(dataset.name);
  }
  for (const dataset of datasets.values()) {
    const namedMetrics = (dataset as AnyDatasetInstance & {
      readonly metrics?: Readonly<Record<string, unknown>>;
    }).metrics;
    if (namedMetrics && Object.keys(namedMetrics).length > 0) {
      throw new Error(
        `Cloud dataset "${dataset.name}" contains named metrics. `
        + 'The dataset-only Cloud publisher does not support named metrics yet.',
      );
    }
  }
  for (const name of Object.keys(options.datasetAccess ?? {})) {
    if (!exposed.has(name)) {
      throw new Error(`Cloud access policy names an unpublished dataset: "${name}".`);
    }
    const access = options.datasetAccess?.[name];
    if (!access || !Array.isArray(access.roles) || !Array.isArray(access.scopes)) {
      throw new Error(`Cloud access policy for "${name}" must set roles and scopes.`);
    }
  }

  const endpoints: Record<string, ProtocolEndpointPolicy> = {};
  for (const dataset of datasets.values()) {
    if (!exposed.has(dataset.name)) continue;
    const access = options.datasetAccess?.[dataset.name] ?? options.access;
    endpoints[dataset.name] = {
          access: {
            kind: 'authenticated',
            roles: [...new Set(access.roles)].sort(),
            scopes: [...new Set(access.scopes)].sort(),
          },
          tenant: dataset.tenantKey
            ? { kind: 'required', mode: 'auto-inject', column: dataset.tenantKey }
            : { kind: 'not-required' },
          maxLimit: dataset.limits?.maxResultSize ?? 1_000,
          path: `/api/analytics/datasets/${dataset.name}/query`,
        };
  }

  return buildProtocolDeploymentContract(
    [...datasets.values()].sort((left, right) => left.name.localeCompare(right.name)),
    { endpoints },
  );
}
