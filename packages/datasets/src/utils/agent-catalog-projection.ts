/**
 * Per-source projections behind `projectAgentSafeCatalog()`.
 *
 * Each function maps one dataset representation onto the logical shape an agent
 * may see. They all apply the same rules — drop dimensions that are neither
 * filterable nor groupable, keep only filters whose field survived that drop,
 * keep only metric references that resolve, and sort every collection by name —
 * so the projection is deterministic regardless of which source produced it.
 */

import type { ProtocolDatasetContract } from '@hypequery/protocol';
import type {
  AgentCatalogDataset,
  AgentCatalogDimension,
  AgentCatalogFilter,
} from '../agent-catalog.js';
import type { DatasetLimits, FieldType } from '../types.js';
import { compareStrings, uniqueSorted } from './canonical-json.js';

/**
 * The structural shape shared by `DatasetCatalog` and `ContractDataset`.
 *
 * Both carry their collections as name-keyed records with the same entry
 * fields, so one projection covers the local-catalog and semantic-contract
 * sources. Only what the projection reads is declared here.
 */
export interface RecordShapedDataset {
  readonly name: string;
  readonly timeKey?: string;
  readonly dimensions: Readonly<Record<string, {
    readonly type: FieldType;
    readonly label?: string;
    readonly description?: string;
    readonly filterable: boolean;
    readonly groupable: boolean;
  }>>;
  readonly measures: Readonly<Record<string, {
    readonly label?: string;
    readonly description?: string;
  }>>;
  readonly metrics: Readonly<Record<string, {
    readonly label?: string;
    readonly description?: string;
    readonly dimensions: readonly string[];
    readonly filters: readonly string[];
    readonly grains: readonly string[];
    readonly grain?: string;
  }>>;
  readonly filters: Readonly<Record<string, {
    readonly field: string;
    readonly label?: string;
    readonly description?: string;
    readonly operators?: readonly string[];
    readonly valueType?: FieldType;
  }>>;
  readonly relationships: Readonly<Record<string, {
    readonly target: string;
    readonly queryable: boolean;
    readonly fields: readonly string[];
  }>>;
  readonly limits?: DatasetLimits;
}

export function optionalText<T extends { label?: string; description?: string }>(
  value: T,
): Pick<T, 'label' | 'description'> {
  return {
    ...(value.label !== undefined ? { label: value.label } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
  } as Pick<T, 'label' | 'description'>;
}

/** Reduces a limits object to the four keys the agent-safe catalog publishes. */
export function normalizedLimits(limits: DatasetLimits | undefined): DatasetLimits {
  return {
    ...(limits?.maxDimensions !== undefined ? { maxDimensions: limits.maxDimensions } : {}),
    ...(limits?.maxMeasures !== undefined ? { maxMeasures: limits.maxMeasures } : {}),
    ...(limits?.maxFilters !== undefined ? { maxFilters: limits.maxFilters } : {}),
    ...(limits?.maxResultSize !== undefined ? { maxResultSize: limits.maxResultSize } : {}),
  };
}

export function datasetDescription(name: string, description?: string): string {
  return description ?? `${name} analytics dataset.`;
}

function sortedByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((left, right) => compareStrings(left.name, right.name));
}

/** Projects a `DatasetCatalog` or `ContractDataset` — they share one shape. */
export function recordDatasetToAgentDataset(dataset: RecordShapedDataset): AgentCatalogDataset {
  const dimensions: AgentCatalogDimension[] = sortedByName(
    Object.entries(dataset.dimensions)
      .filter(([, dimension]) => dimension.filterable || dimension.groupable)
      .map(([name, dimension]) => ({
        name,
        type: dimension.type,
        ...optionalText(dimension),
        filterable: dimension.filterable,
        groupable: dimension.groupable,
      })),
  );
  const dimensionNames = new Set(dimensions.map(dimension => dimension.name));
  // A filter is only publishable when its backing dimension survived above;
  // otherwise it would name a field the agent cannot see or select.
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
    measures: sortedByName(
      Object.entries(dataset.measures).map(([name, measure]) => ({ name, ...optionalText(measure) })),
    ),
    metrics: sortedByName(
      Object.entries(dataset.metrics).map(([name, metric]) => ({
        name,
        ...optionalText(metric),
        dimensions: uniqueSorted(metric.dimensions.filter(item => dimensionNames.has(item))),
        filters: uniqueSorted(metric.filters.filter(item => filterNames.has(item))),
        grains: uniqueSorted(metric.grains),
        ...(metric.grain !== undefined ? { grain: metric.grain } : {}),
      })),
    ),
    filters: sortedByName(
      Object.entries(dataset.filters)
        .filter(([name]) => filterNames.has(name))
        .map(([name, filter]): AgentCatalogFilter => ({
          name,
          type: filter.valueType as FieldType,
          operators: uniqueSorted(filter.operators ?? []),
        })),
    ),
    relationships: sortedByName(
      Object.entries(dataset.relationships)
        .filter(([, relationship]) => relationship.queryable)
        .map(([name, relationship]) => ({
          name,
          target: relationship.target,
          fields: uniqueSorted(relationship.fields),
        })),
    ),
    limits: normalizedLimits(dataset.limits),
  };
}

/**
 * Projects a portable deployment contract dataset.
 *
 * Kept separate from `recordDatasetToAgentDataset`: the contract carries its
 * collections as arrays of named entries, and relationship fields are not
 * stored — they are derived from the target dataset's publishable dimensions.
 */
export function protocolDatasetToAgentDataset(
  dataset: ProtocolDatasetContract,
  datasets: ReadonlyMap<string, ProtocolDatasetContract>,
): AgentCatalogDataset {
  const dimensions: AgentCatalogDimension[] = sortedByName(
    dataset.dimensions
      .filter(dimension => dimension.filterable || dimension.groupable)
      .map(dimension => ({
        name: dimension.name,
        type: dimension.type,
        ...optionalText(dimension),
        filterable: dimension.filterable,
        groupable: dimension.groupable,
      })),
  );
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
    measures: sortedByName(
      dataset.measures.map(measure => ({ name: measure.name, ...optionalText(measure) })),
    ),
    metrics: sortedByName(
      dataset.metrics.map(metric => ({
        name: metric.name,
        ...optionalText(metric),
        dimensions: uniqueSorted(metric.dimensions.filter(name => dimensionNames.has(String(name)))),
        filters: uniqueSorted(metric.filters.filter(name => filterNames.has(String(name)))),
        grains: uniqueSorted(metric.grains),
        ...(metric.grain !== undefined ? { grain: metric.grain } : {}),
      })),
    ),
    filters: sortedByName(
      dataset.filters
        .filter(filter => filterNames.has(String(filter.name)))
        .map((filter): AgentCatalogFilter | undefined => {
          const type = dimensionTypes.get(String(filter.field));
          return type === undefined ? undefined : {
            name: filter.name,
            type,
            operators: uniqueSorted(filter.operators),
          };
        })
        .filter((filter): filter is AgentCatalogFilter => filter !== undefined),
    ),
    relationships: sortedByName(
      dataset.relationships
        .filter(relationship => relationship.queryable)
        .map(relationship => ({
          name: relationship.name,
          target: relationship.target,
          fields: uniqueSorted(
            (datasets.get(relationship.target)?.dimensions ?? [])
              .filter(dimension => dimension.filterable || dimension.groupable)
              .map(dimension => `${relationship.name}.${dimension.name}`),
          ),
        })),
    ),
    limits: normalizedLimits(dataset.limits),
  };
}
