import type {
  AnyDatasetInstance,
  DimensionDefinition,
  MeasureDefinition,
  MetricHandle,
  RelationshipDefinition,
  SemanticFilterDefinition,
  DatasetLimits,
} from './types.js';

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
}

export interface FilterCatalogEntry {
  field: string;
  label?: string;
  description?: string;
  operators?: SemanticFilterDefinition['operators'];
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
  };
}

function filterToCatalog(filter: SemanticFilterDefinition): FilterCatalogEntry {
  return {
    field: filter.field,
    label: filter.label,
    description: filter.description,
    operators: filter.operators,
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
        filterToCatalog(filter),
      ]),
    ),
    relationships: Object.fromEntries(
      Object.entries(dataset.relationships).map(([name, relationship]) => [
        name,
        relationshipToCatalog(relationship),
      ]),
    ),
    limits: dataset.limits,
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
