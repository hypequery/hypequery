import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import {
  getDatasetCatalog,
  type DatasetCatalog,
  type DatasetCatalogMap,
  type DatasetCatalogSource,
} from './catalog.js';
import type { SemanticContract } from './contract.js';
import type { DatasetLimits, FieldType } from './types.js';
import { compareStrings } from './utils/canonical-json.js';
import {
  protocolDatasetToAgentDataset,
  recordDatasetToAgentDataset,
} from './utils/agent-catalog-projection.js';

export interface AgentCatalogDimension {
  name: string;
  type: FieldType;
  label?: string;
  description?: string;
  filterable: boolean;
  groupable: boolean;
}

export interface AgentCatalogMeasure {
  name: string;
  label?: string;
  description?: string;
}

export interface AgentCatalogMetric {
  name: string;
  label?: string;
  description?: string;
  dimensions: string[];
  filters: string[];
  grains: string[];
  grain?: string;
}

export interface AgentCatalogFilter {
  name: string;
  type: FieldType;
  operators: string[];
}

export interface AgentCatalogRelationship {
  name: string;
  target: string;
  fields: string[];
}

export interface AgentCatalogDataset {
  name: string;
  description: string;
  timeDimension: string | null;
  dimensions: AgentCatalogDimension[];
  measures: AgentCatalogMeasure[];
  metrics: AgentCatalogMetric[];
  filters: AgentCatalogFilter[];
  relationships: AgentCatalogRelationship[];
  limits: DatasetLimits;
}

export interface AgentSafeCatalog {
  datasets: AgentCatalogDataset[];
}

export type AgentCatalogDatasetRegistry = Readonly<
  Record<string, DatasetCatalogSource | DatasetCatalog>
>;

export type AgentCatalogSource =
  | AgentCatalogDatasetRegistry
  | SemanticContract
  | ProtocolDeploymentContract;

/**
 * Proof supplied by an owning application after it authorizes a trusted-debug
 * request. The datasets package deliberately does not manufacture this value:
 * authentication and authorization belong to the calling transport/runtime.
 */
export interface TrustedDebugCatalogAuthorization {
  readonly authorized: true;
}

export type TrustedDebugCatalog =
  | { readonly kind: 'dataset-catalog'; readonly datasets: DatasetCatalogMap }
  | { readonly kind: 'semantic-contract'; readonly contract: SemanticContract }
  | { readonly kind: 'deployment-contract'; readonly contract: ProtocolDeploymentContract };

function isProtocolDeploymentContract(source: AgentCatalogSource): source is ProtocolDeploymentContract {
  return 'kind' in source && source.kind === 'hypequery-deployment';
}

function isSemanticContract(source: AgentCatalogSource): source is SemanticContract {
  return 'contentHash' in source && typeof source.contentHash === 'string';
}

/** Build the deterministic logical catalog that may safely be shown to an agent. */
export function projectAgentSafeCatalog(source: AgentCatalogSource): AgentSafeCatalog {
  if (isProtocolDeploymentContract(source)) {
    const datasets = new Map(source.datasets.map(dataset => [dataset.name, dataset]));
    return {
      datasets: source.datasets
        .map(dataset => protocolDatasetToAgentDataset(dataset, datasets))
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  }

  if (isSemanticContract(source)) {
    return {
      datasets: Object.values(source.datasets)
        .map(recordDatasetToAgentDataset)
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  }

  return {
    datasets: Object.entries(source)
      .map(([, dataset]) => (
        'requiresTenant' in dataset ? dataset : getDatasetCatalog(dataset)
      ))
      .map(recordDatasetToAgentDataset)
      .sort((left, right) => compareStrings(left.name, right.name)),
  };
}

/**
 * Return physical diagnostics only after the owning application has performed
 * a separate authorization check. Never place this projection in model context.
 */
export function projectTrustedDebugCatalog(
  source: AgentCatalogSource,
  authorization: TrustedDebugCatalogAuthorization,
): TrustedDebugCatalog {
  if (authorization?.authorized !== true) {
    throw new Error('Trusted debug catalog access requires explicit authorization.');
  }
  if (isProtocolDeploymentContract(source)) {
    return { kind: 'deployment-contract', contract: source };
  }
  if (isSemanticContract(source)) {
    return { kind: 'semantic-contract', contract: source };
  }
  return {
    kind: 'dataset-catalog',
    datasets: Object.fromEntries(Object.entries(source).map(([name, dataset]) => [
      name,
      'requiresTenant' in dataset ? dataset : getDatasetCatalog(dataset),
    ])),
  };
}
