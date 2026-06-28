import { createHash } from 'node:crypto';
import {
  getDatasetCatalogs,
  type DatasetCatalog,
  type DatasetCatalogSource,
  type DimensionCatalogEntry,
  type MeasureCatalogEntry,
  type MetricCatalogEntry,
  type FilterCatalogEntry,
  type RelationshipCatalogEntry,
} from './catalog.js';
import type { DatasetLimits } from './types.js';

/**
 * Version of the semantic contract format. Bump when the serialized shape
 * changes in a way that snapshot consumers must account for.
 */
export const SEMANTIC_CONTRACT_VERSION = 1;

export interface ContractDimension {
  type: DimensionCatalogEntry['type'];
  column?: string;
  sql?: string;
  label?: string;
  description?: string;
  filterable: boolean;
  groupable: boolean;
}

export interface ContractMeasure {
  aggregation: MeasureCatalogEntry['aggregation'];
  field: string;
  sql?: string;
  label?: string;
  description?: string;
}

export interface ContractMetric {
  kind: MetricCatalogEntry['kind'];
  valueType: MetricCatalogEntry['valueType'];
  label?: string;
  description?: string;
  dimensions: string[];
  measures?: string[];
  filters: string[];
  grains: string[];
  grain?: string;
  requires?: string[];
}

export interface ContractFilter {
  field: string;
  label?: string;
  description?: string;
  operators: string[];
  valueType?: FilterCatalogEntry['valueType'];
}

export interface ContractRelationship {
  kind: RelationshipCatalogEntry['kind'];
  target: string;
  from: string;
  to: string;
}

export interface ContractDataset {
  name: string;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  requiresTenant: boolean;
  supportedGrains: string[];
  dimensions: Record<string, ContractDimension>;
  measures: Record<string, ContractMeasure>;
  metrics: Record<string, ContractMetric>;
  filters: Record<string, ContractFilter>;
  relationships: Record<string, ContractRelationship>;
  limits?: DatasetLimits;
}

export interface SemanticContract {
  version: number;
  datasets: Record<string, ContractDataset>;
  contentHash: string;
}

type SemanticContractWithoutHash = Omit<SemanticContract, 'contentHash'>;

/**
 * Builds a deterministic semantic contract from dataset instances.
 *
 * The contract is a normalized, sorted projection of the dataset catalog with a
 * version marker and content hash. Object keys and unordered arrays are sorted,
 * and SQL escape hatches are whitespace-normalized so logically equal models
 * produce identical JSON and hashes. This is the shared source consumed by
 * snapshots, diffs, CI validation, docs, and codegen.
 */
export function serializeSemanticContract(
  datasets: Record<string, DatasetCatalogSource>,
): SemanticContract {
  const catalogs = getDatasetCatalogs(datasets);

  const contract: SemanticContractWithoutHash = {
    version: SEMANTIC_CONTRACT_VERSION,
    datasets: sortedRecord(
      Object.entries(catalogs).map(([name, catalog]) => [name, datasetToContract(catalog)]),
    ),
  };

  return {
    ...contract,
    contentHash: hashContract(contract),
  };
}

function datasetToContract(catalog: DatasetCatalog): ContractDataset {
  return {
    name: catalog.name,
    source: catalog.source,
    ...(catalog.tenantKey !== undefined ? { tenantKey: catalog.tenantKey } : {}),
    ...(catalog.timeKey !== undefined ? { timeKey: catalog.timeKey } : {}),
    requiresTenant: catalog.requiresTenant,
    supportedGrains: [...catalog.supportedGrains].sort(),
    dimensions: sortedRecord(
      Object.entries(catalog.dimensions).map(([name, entry]) => [name, dimensionToContract(entry)]),
    ),
    measures: sortedRecord(
      Object.entries(catalog.measures).map(([name, entry]) => [name, measureToContract(entry)]),
    ),
    metrics: sortedRecord(
      Object.entries(catalog.metrics).map(([name, entry]) => [name, metricToContract(entry)]),
    ),
    filters: sortedRecord(
      Object.entries(catalog.filters).map(([name, entry]) => [name, filterToContract(entry)]),
    ),
    relationships: sortedRecord(
      Object.entries(catalog.relationships).map(([name, entry]) => [name, relationshipToContract(entry)]),
    ),
    ...(catalog.limits !== undefined ? { limits: catalog.limits } : {}),
  };
}

function dimensionToContract(entry: DimensionCatalogEntry): ContractDimension {
  return {
    type: entry.type,
    ...(entry.column !== undefined ? { column: entry.column } : {}),
    ...(entry.sql !== undefined ? { sql: normalizeSql(entry.sql) } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    filterable: entry.filterable,
    groupable: entry.groupable,
  };
}

function measureToContract(entry: MeasureCatalogEntry): ContractMeasure {
  return {
    aggregation: entry.aggregation,
    field: entry.field,
    ...(entry.sql !== undefined ? { sql: normalizeSql(entry.sql) } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  };
}

function metricToContract(entry: MetricCatalogEntry): ContractMetric {
  return {
    kind: entry.kind,
    valueType: entry.valueType,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    dimensions: [...entry.dimensions].sort(),
    ...(entry.measures !== undefined ? { measures: [...entry.measures].sort() } : {}),
    filters: [...entry.filters].sort(),
    grains: [...entry.grains].sort(),
    ...(entry.grain !== undefined ? { grain: entry.grain } : {}),
    ...(entry.requires !== undefined ? { requires: [...entry.requires].sort() } : {}),
  };
}

function filterToContract(entry: FilterCatalogEntry): ContractFilter {
  return {
    field: entry.field,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    operators: [...(entry.operators ?? [])].sort(),
    ...(entry.valueType !== undefined ? { valueType: entry.valueType } : {}),
  };
}

function relationshipToContract(entry: RelationshipCatalogEntry): ContractRelationship {
  return {
    kind: entry.kind,
    target: entry.target,
    from: entry.from,
    to: entry.to,
  };
}

/**
 * Serializes a contract with stable formatting for writing to disk and hashing.
 */
export function contractToStableJson(
  contract: SemanticContract | SemanticContractWithoutHash,
): string {
  return JSON.stringify(contract, null, 2);
}

/**
 * Computes the SHA-256 content hash for a normalized contract.
 */
export function hashContract(
  contract: SemanticContract | SemanticContractWithoutHash,
): string {
  return createHash('sha256').update(contractToStableJson(contract)).digest('hex');
}

/** Builds an object whose keys are inserted in sorted order for stable JSON. */
function sortedRecord<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Normalizes SQL escape-hatch whitespace so equivalent SQL hashes identically. */
function normalizeSql(sql: string): string {
  const lines = sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/g, ''));

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map(line => line.slice(minIndent))
    .join('\n')
    .trim();
}
