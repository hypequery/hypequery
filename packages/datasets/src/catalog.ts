import type {
  AnyDatasetInstance,
  DimensionDefinition,
  MeasureDefinition,
  MetricHandle,
  RelationshipDefinition,
  SemanticFilterDefinition,
  DatasetLimits,
  TimeGrain,
} from './types.js';
import { SEMANTIC_FILTER_OPERATORS, SUPPORTED_TIME_GRAINS } from './constants.js';

export interface DimensionCatalogEntry {
  type: DimensionDefinition['fieldType'];
  column?: string;
  sql?: string;
  label?: string;
  description?: string;
  filterable: boolean;
  groupable: boolean;
}

export interface MeasureCatalogEntry {
  aggregation: MeasureDefinition['aggregation'];
  field: string;
  sql?: string;
  label?: string;
  description?: string;
  filterCount: number;
}

export interface FilterCatalogEntry {
  field: string;
  label?: string;
  description?: string;
  operators: SemanticFilterDefinition['operators'];
  valueType?: DimensionDefinition['fieldType'];
}

export interface MetricCatalogEntry {
  kind: ReturnType<MetricHandle['contract']>['kind'];
  dataset: string;
  valueType: 'number';
  label?: string;
  description?: string;
  dimensions: string[];
  measures?: string[];
  filters: string[];
  grains: string[];
  grain?: string;
  requires?: string[];
}

export interface RelationshipCatalogEntry {
  kind: RelationshipDefinition['kind'];
  target: string;
  from: string;
  to: string;
  execution: 'metadata_only';
}

export interface DatasetCatalog {
  name: string;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: Record<string, DimensionCatalogEntry>;
  measures: Record<string, MeasureCatalogEntry>;
  metrics: Record<string, MetricCatalogEntry>;
  filters: Record<string, FilterCatalogEntry>;
  relationships: Record<string, RelationshipCatalogEntry>;
  limits?: DatasetLimits;
  requiresTenant: boolean;
  supportedGrains: TimeGrain[];
  orderableFields: string[];
  maxLimit?: number;
}

export type DatasetCatalogMap = Record<string, DatasetCatalog>;
export type DatasetCatalogSource = AnyDatasetInstance & {
  metrics?: Record<string, MetricHandle>;
};

function dimensionToCatalog(dimension: DimensionDefinition): DimensionCatalogEntry {
  return {
    type: dimension.fieldType,
    column: dimension.column,
    sql: dimension.sql,
    label: dimension.label,
    description: dimension.description,
    filterable: dimension.filterable !== false,
    groupable: dimension.groupable !== false,
  };
}

function measureToCatalog(measure: MeasureDefinition): MeasureCatalogEntry {
  return {
    aggregation: measure.aggregation,
    field: measure.field,
    sql: measure.sql,
    label: measure.label,
    description: measure.description,
    filterCount: measure.filters?.length ?? 0,
  };
}

function filterToCatalog(
  filter: SemanticFilterDefinition,
  dimensions: AnyDatasetInstance['dimensions'],
): FilterCatalogEntry {
  return {
    field: filter.field,
    label: filter.label,
    description: filter.description,
    operators: filter.operators ? [...filter.operators] : [...SEMANTIC_FILTER_OPERATORS],
    valueType: dimensions[filter.field]?.fieldType,
  };
}

function metricToCatalog(metric: MetricHandle): MetricCatalogEntry {
  const contract = metric.contract();
  return {
    kind: contract.kind,
    dataset: contract.dataset,
    valueType: contract.valueType,
    label: contract.label,
    description: contract.description,
    dimensions: contract.dimensions,
    measures: contract.measures,
    filters: contract.filters,
    grains: contract.grains,
    grain: contract.grain,
    requires: contract.requires,
  };
}

function relationshipToCatalog(relationship: RelationshipDefinition): RelationshipCatalogEntry {
  return {
    kind: relationship.kind,
    target: relationship.target().name,
    from: relationship.from,
    to: relationship.to,
    execution: 'metadata_only',
  };
}

export function getDatasetCatalog(dataset: DatasetCatalogSource): DatasetCatalog {
  const dimensionNames = Object.keys(dataset.dimensions);
  const measureNames = Object.keys(dataset.measures);
  const metricNames = Object.keys(dataset.metrics ?? {});
  const supportedGrains = dataset.timeKey ? [...SUPPORTED_TIME_GRAINS] : [];
  const maxLimit = dataset.limits?.maxResultSize;

  return {
    name: dataset.name,
    source: dataset.source,
    tenantKey: dataset.tenantKey,
    timeKey: dataset.timeKey,
    dimensions: Object.fromEntries(
      Object.entries(dataset.dimensions).map(([name, dimension]) => [
        name,
        dimensionToCatalog(dimension),
      ]),
    ),
    measures: Object.fromEntries(
      Object.entries(dataset.measures).map(([name, measure]) => [
        name,
        measureToCatalog(measure),
      ]),
    ),
    metrics: Object.fromEntries(
      Object.entries(dataset.metrics ?? {}).map(([name, metric]) => [
        name,
        metricToCatalog(metric),
      ]),
    ),
    filters: Object.fromEntries(
      Object.entries(dataset.filters).map(([name, filter]) => [
        name,
        filterToCatalog(filter, dataset.dimensions),
      ]),
    ),
    relationships: Object.fromEntries(
      Object.entries(dataset.relationships).map(([name, relationship]) => [
        name,
        relationshipToCatalog(relationship),
      ]),
    ),
    limits: dataset.limits,
    requiresTenant: !!dataset.tenantKey,
    supportedGrains,
    orderableFields: [
      ...dimensionNames,
      ...measureNames,
      ...metricNames,
      ...(dataset.timeKey ? ['period'] : []),
    ],
    maxLimit,
  };
}

export function getDatasetCatalogs(datasets: Record<string, DatasetCatalogSource>): DatasetCatalogMap {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, dataset]) => [
      name,
      getDatasetCatalog(dataset),
    ]),
  );
}
