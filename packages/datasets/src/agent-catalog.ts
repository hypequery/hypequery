import type { ProtocolDatasetContract, ProtocolDeploymentContract } from '@hypequery/protocol';
import {
  getDatasetCatalog,
  type DatasetCatalog,
  type DatasetCatalogMap,
  type DatasetCatalogSource,
} from './catalog.js';
import type {
  ContractDataset,
  SemanticContract,
} from './contract.js';
import type {
  DatasetDefaults,
  DatasetFreshness,
  DatasetLimits,
  FieldType,
  SemanticMetadata,
} from './types.js';
import { compareStrings, uniqueSorted } from './utils/canonical-json.js';
import { snapshotSemanticMetadata } from './utils/semantic-metadata.js';

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

function optionalText<T extends { label?: string; description?: string }>(
  value: T,
): Pick<T, 'label' | 'description'> {
  return {
    ...(value.label !== undefined ? { label: value.label } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
  } as Pick<T, 'label' | 'description'>;
}

function normalizedLimits(limits: DatasetLimits | undefined): DatasetLimits {
  return {
    ...(limits?.maxDimensions !== undefined ? { maxDimensions: limits.maxDimensions } : {}),
    ...(limits?.maxMeasures !== undefined ? { maxMeasures: limits.maxMeasures } : {}),
    ...(limits?.maxFilters !== undefined ? { maxFilters: limits.maxFilters } : {}),
    ...(limits?.maxResultSize !== undefined ? { maxResultSize: limits.maxResultSize } : {}),
  };
}

function datasetDescription(name: string, description?: string): string {
  return description ?? `${name} analytics dataset.`;
}

function snapshotDefaults(defaults: DatasetDefaults): DatasetDefaults {
  return {
    ...(defaults.dimensions !== undefined
      ? { dimensions: uniqueSorted(defaults.dimensions) }
      : {}),
    ...(defaults.timeGrain !== undefined ? { timeGrain: defaults.timeGrain } : {}),
  };
}

function localCatalogToAgentDataset(catalog: DatasetCatalog): AgentCatalogDataset {
  const dimensions = Object.entries(catalog.dimensions)
    .filter(([, dimension]) => dimension.filterable || dimension.groupable)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, dimension]) => ({
      name,
      type: dimension.type,
      ...optionalText(dimension),
      ...snapshotSemanticMetadata(dimension),
      filterable: dimension.filterable,
      groupable: dimension.groupable,
    }));
  const dimensionNames = new Set(dimensions.map(dimension => dimension.name));
  const filterNames = new Set(
    Object.entries(catalog.filters)
      .filter(([, filter]) => filter.valueType !== undefined && dimensionNames.has(filter.field))
      .map(([name]) => name),
  );

  return {
    name: catalog.name,
    description: datasetDescription(catalog.name, catalog.description),
    ...snapshotSemanticMetadata(catalog),
    ...(catalog.freshness !== undefined ? { freshness: { ...catalog.freshness } } : {}),
    ...(catalog.owner !== undefined ? { owner: catalog.owner } : {}),
    ...(catalog.defaults !== undefined ? { defaults: snapshotDefaults(catalog.defaults) } : {}),
    timeDimension: catalog.timeKey !== undefined && dimensionNames.has(catalog.timeKey)
      ? catalog.timeKey
      : null,
    dimensions,
    measures: Object.entries(catalog.measures)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, measure]) => ({
        name,
        ...optionalText(measure),
        ...snapshotSemanticMetadata(measure),
      })),
    metrics: Object.entries(catalog.metrics)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, metric]) => ({
        name,
        ...optionalText(metric),
        ...snapshotSemanticMetadata(metric),
        dimensions: uniqueSorted(metric.dimensions.filter(name => dimensionNames.has(name))),
        filters: uniqueSorted(metric.filters.filter(name => filterNames.has(name))),
        grains: uniqueSorted(metric.grains),
        ...(metric.grain !== undefined ? { grain: metric.grain } : {}),
      })),
    filters: Object.entries(catalog.filters)
      .filter(([name]) => filterNames.has(name))
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, filter]) => ({
        name,
        type: filter.valueType as FieldType,
        ...optionalText(filter),
        ...snapshotSemanticMetadata(filter),
        operators: uniqueSorted(filter.operators ?? []),
      })),
    relationships: Object.entries(catalog.relationships)
      .filter(([, relationship]) => relationship.queryable)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, relationship]) => ({
        name,
        target: relationship.target,
        fields: uniqueSorted(relationship.fields),
      })),
    limits: normalizedLimits(catalog.limits),
  };
}

function semanticContractDatasetToAgentDataset(dataset: ContractDataset): AgentCatalogDataset {
  const dimensions = Object.entries(dataset.dimensions)
    .filter(([, dimension]) => dimension.filterable || dimension.groupable)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, dimension]) => ({
      name,
      type: dimension.type,
      ...optionalText(dimension),
      ...snapshotSemanticMetadata(dimension),
      filterable: dimension.filterable,
      groupable: dimension.groupable,
    }));
  const dimensionNames = new Set(dimensions.map(dimension => dimension.name));
  const filterNames = new Set(
    Object.entries(dataset.filters)
      .filter(([, filter]) => filter.valueType !== undefined && dimensionNames.has(filter.field))
      .map(([name]) => name),
  );

  return {
    name: dataset.name,
    description: datasetDescription(dataset.name, dataset.description),
    ...snapshotSemanticMetadata(dataset),
    ...(dataset.freshness !== undefined ? { freshness: { ...dataset.freshness } } : {}),
    ...(dataset.owner !== undefined ? { owner: dataset.owner } : {}),
    ...(dataset.defaults !== undefined ? { defaults: snapshotDefaults(dataset.defaults) } : {}),
    timeDimension: dataset.timeKey !== undefined && dimensionNames.has(dataset.timeKey)
      ? dataset.timeKey
      : null,
    dimensions,
    measures: Object.entries(dataset.measures)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, measure]) => ({
        name,
        ...optionalText(measure),
        ...snapshotSemanticMetadata(measure),
      })),
    metrics: Object.entries(dataset.metrics)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, metric]) => ({
        name,
        ...optionalText(metric),
        ...snapshotSemanticMetadata(metric),
        dimensions: uniqueSorted(metric.dimensions.filter(name => dimensionNames.has(name))),
        filters: uniqueSorted(metric.filters.filter(name => filterNames.has(name))),
        grains: uniqueSorted(metric.grains),
        ...(metric.grain !== undefined ? { grain: metric.grain } : {}),
      })),
    filters: Object.entries(dataset.filters)
      .filter(([name]) => filterNames.has(name))
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, filter]) => ({
        name,
        type: filter.valueType as FieldType,
        ...optionalText(filter),
        ...snapshotSemanticMetadata(filter),
        operators: uniqueSorted(filter.operators),
      })),
    relationships: Object.entries(dataset.relationships)
      .filter(([, relationship]) => relationship.queryable)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, relationship]) => ({
        name,
        target: relationship.target,
        fields: uniqueSorted(relationship.fields),
      })),
    limits: normalizedLimits(dataset.limits),
  };
}

function protocolDatasetToAgentDataset(
  dataset: ProtocolDatasetContract,
  datasets: ReadonlyMap<string, ProtocolDatasetContract>,
): AgentCatalogDataset {
  const dimensions = dataset.dimensions
    .filter(dimension => dimension.filterable || dimension.groupable)
    .map(dimension => ({
      name: dimension.name,
      type: dimension.type,
      ...optionalText(dimension),
      ...snapshotSemanticMetadata(dimension),
      filterable: dimension.filterable,
      groupable: dimension.groupable,
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
  const dimensionNames = new Set<string>(dimensions.map(dimension => dimension.name));
  const dimensionTypes = new Map<string, FieldType>(
    dataset.dimensions.map(dimension => [dimension.name, dimension.type]),
  );
  const filterNames = new Set(
    dataset.filters
      .filter(filter => dimensionNames.has(String(filter.field)))
      .map(filter => String(filter.name)),
  );

  return {
    name: dataset.name,
    description: datasetDescription(dataset.name, dataset.description),
    ...snapshotSemanticMetadata(dataset),
    ...(dataset.freshness !== undefined ? { freshness: { ...dataset.freshness } } : {}),
    ...(dataset.owner !== undefined ? { owner: dataset.owner } : {}),
    ...(dataset.defaults !== undefined ? { defaults: snapshotDefaults(dataset.defaults) } : {}),
    timeDimension: dataset.timeField !== undefined && dimensionNames.has(String(dataset.timeField))
      ? String(dataset.timeField)
      : null,
    dimensions,
    measures: dataset.measures
      .map(measure => ({
        name: measure.name,
        ...optionalText(measure),
        ...snapshotSemanticMetadata(measure),
      }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    metrics: dataset.metrics
      .map(metric => ({
        name: metric.name,
        ...optionalText(metric),
        ...snapshotSemanticMetadata(metric),
        dimensions: uniqueSorted(metric.dimensions.filter(name => dimensionNames.has(String(name)))),
        filters: uniqueSorted(metric.filters.filter(name => filterNames.has(String(name)))),
        grains: uniqueSorted(metric.grains),
        ...(metric.grain !== undefined ? { grain: metric.grain } : {}),
      }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    filters: dataset.filters
      .filter(filter => filterNames.has(String(filter.name)))
      .map((filter): AgentCatalogFilter | undefined => {
        const type = dimensionTypes.get(String(filter.field));
        return type === undefined ? undefined : {
          name: filter.name,
          type,
          ...optionalText(filter),
          ...snapshotSemanticMetadata(filter),
          operators: uniqueSorted(filter.operators),
        };
      })
      .filter((filter): filter is AgentCatalogFilter => filter !== undefined)
      .sort((left, right) => compareStrings(left.name, right.name)),
    relationships: dataset.relationships
      .filter(relationship => relationship.queryable)
      .map(relationship => ({
        name: relationship.name,
        target: relationship.target,
        fields: uniqueSorted(
          (datasets.get(relationship.target)?.dimensions ?? [])
            .filter(dimension => dimension.filterable || dimension.groupable)
            .map(dimension => `${relationship.name}.${dimension.name}`),
        ),
      }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    limits: normalizedLimits(dataset.limits),
  };
}

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
        .map(semanticContractDatasetToAgentDataset)
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  } else {
    catalog = {
      datasets: Object.entries(source)
        .map(([, dataset]) => (
          'requiresTenant' in dataset ? dataset : getDatasetCatalog(dataset)
        ))
        .map(localCatalogToAgentDataset)
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
