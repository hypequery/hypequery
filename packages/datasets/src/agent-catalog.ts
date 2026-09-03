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
import type { DatasetLimits, FieldType } from './types.js';
import { compareStrings, uniqueSorted } from './utils/canonical-json.js';

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

function localCatalogToAgentDataset(catalog: DatasetCatalog): AgentCatalogDataset {
  const dimensions = Object.entries(catalog.dimensions)
    .filter(([, dimension]) => dimension.filterable || dimension.groupable)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, dimension]) => ({
      name,
      type: dimension.type,
      ...optionalText(dimension),
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
    description: datasetDescription(catalog.name),
    timeDimension: catalog.timeKey !== undefined && dimensionNames.has(catalog.timeKey)
      ? catalog.timeKey
      : null,
    dimensions,
    measures: Object.entries(catalog.measures)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, measure]) => ({ name, ...optionalText(measure) })),
    metrics: Object.entries(catalog.metrics)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, metric]) => ({
        name,
        ...optionalText(metric),
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
    description: datasetDescription(dataset.name),
    timeDimension: dataset.timeKey !== undefined && dimensionNames.has(dataset.timeKey)
      ? dataset.timeKey
      : null,
    dimensions,
    measures: Object.entries(dataset.measures)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, measure]) => ({ name, ...optionalText(measure) })),
    metrics: Object.entries(dataset.metrics)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, metric]) => ({
        name,
        ...optionalText(metric),
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
    description: datasetDescription(dataset.name),
    timeDimension: dataset.timeField !== undefined && dimensionNames.has(String(dataset.timeField))
      ? String(dataset.timeField)
      : null,
    dimensions,
    measures: dataset.measures
      .map(measure => ({ name: measure.name, ...optionalText(measure) }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    metrics: dataset.metrics
      .map(metric => ({
        name: metric.name,
        ...optionalText(metric),
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
        .map(semanticContractDatasetToAgentDataset)
        .sort((left, right) => compareStrings(left.name, right.name)),
    };
  }

  return {
    datasets: Object.entries(source)
      .map(([, dataset]) => (
        'requiresTenant' in dataset ? dataset : getDatasetCatalog(dataset)
      ))
      .map(localCatalogToAgentDataset)
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
