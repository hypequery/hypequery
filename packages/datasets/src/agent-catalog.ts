import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import {
  getDatasetCatalog,
  type DatasetCatalog,
  type DatasetCatalogMap,
  type DatasetCatalogSource,
} from './catalog.js';
import type { SemanticContract } from './contract.js';
import type {
  DatasetDefaults,
  DatasetFreshness,
  DatasetLimits,
  FieldType,
  SemanticMetadata,
} from './types.js';
import { compareStrings } from './utils/canonical-json.js';
import {
  protocolDatasetToAgentDataset,
  recordDatasetToAgentDataset,
} from './utils/agent-catalog-projection.js';

export interface AgentCatalogDimension extends SemanticMetadata {
  name: string;
  type: FieldType;
  label?: string;
  description?: string;
  filterable: boolean;
  groupable: boolean;
}

export interface AgentCatalogMeasure extends SemanticMetadata {
  name: string;
  label?: string;
  description?: string;
}

export interface AgentCatalogMetric extends SemanticMetadata {
  name: string;
  label?: string;
  description?: string;
  dimensions: string[];
  filters: string[];
  grains: string[];
  grain?: string;
}

export interface AgentCatalogFilter extends SemanticMetadata {
  name: string;
  type: FieldType;
  label?: string;
  description?: string;
  operators: string[];
}

export interface AgentCatalogRelationship {
  name: string;
  target: string;
  fields: string[];
}

export interface AgentCatalogDataset extends SemanticMetadata {
  name: string;
  description: string;
  freshness?: DatasetFreshness;
  owner?: string;
  defaults?: DatasetDefaults;
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

export interface AgentCatalogProjectionOptions {
  /** Maximum UTF-8 bytes in the complete safe catalog. Defaults to 256 KiB. */
  maxCatalogBytes?: number;
}

export const DEFAULT_AGENT_CATALOG_MAX_BYTES = 256 * 1024;

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
export function projectAgentSafeCatalog(
  source: AgentCatalogSource,
  options: AgentCatalogProjectionOptions = {},
): AgentSafeCatalog {
  let catalog: AgentSafeCatalog;
  if (isProtocolDeploymentContract(source)) {
    const datasets = new Map(source.datasets.map(dataset => [dataset.name, dataset]));
    catalog = {
      datasets: source.datasets
        .map(dataset => protocolDatasetToAgentDataset(dataset, datasets))
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  } else if (isSemanticContract(source)) {
    catalog = {
      datasets: Object.values(source.datasets)
        .map(recordDatasetToAgentDataset)
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  } else {
    catalog = {
      datasets: Object.entries(source)
        .map(([, dataset]) => (
          'requiresTenant' in dataset ? dataset : getDatasetCatalog(dataset)
        ))
        .map(recordDatasetToAgentDataset)
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  }

  assertAgentSafeCatalogBudget(catalog, options);
  return catalog;
}

/**
 * Enforce the agent-safe catalog byte budget.
 *
 * Exported so an adapter that builds a projection by another route — the MCP
 * legacy registry fallback is the only one today — gets the same guarantee as
 * `projectAgentSafeCatalog` rather than serializing an unbounded catalog and
 * failing later against an unrelated response limit.
 */
export function assertAgentSafeCatalogBudget(
  catalog: AgentSafeCatalog,
  options: AgentCatalogProjectionOptions = {},
): void {
  const maxBytes = options.maxCatalogBytes ?? DEFAULT_AGENT_CATALOG_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxCatalogBytes must be a positive safe integer.');
  }
  const byteLength = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
  if (byteLength > maxBytes) {
    throw new RangeError(`Agent-safe catalog exceeds the ${maxBytes}-byte limit.`);
  }
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
