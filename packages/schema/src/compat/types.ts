import type { Snapshot } from '../snapshot/index.js';

export interface CompatibilityMetricFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' | 'like';
  value: unknown;
}

export interface CompatibilityDimensionDefinition {
  column?: string;
  sql?: string;
}

export interface CompatibilityMeasureDefinition {
  aggregation: 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max';
  field: string;
  sql?: string;
  filters?: CompatibilityMetricFilter[];
}

export interface CompatibilityRelationshipTarget {
  name: string;
  source?: string;
  dimensions?: Record<string, CompatibilityDimensionDefinition>;
}

export interface CompatibilityRelationshipDefinition {
  kind: 'belongsTo' | 'hasMany' | 'hasOne';
  target: () => CompatibilityRelationshipTarget;
  from: string;
  to: string;
}

export interface CompatibilitySemanticFilterDefinition {
  field: string;
}

export interface CompatibilityDatasetInstance {
  name: string;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: Record<string, CompatibilityDimensionDefinition>;
  measures: Record<string, CompatibilityMeasureDefinition>;
  filters: Record<string, CompatibilitySemanticFilterDefinition>;
  relationships?: Record<string, CompatibilityRelationshipDefinition>;
}

export interface CheckDatasetsAgainstSchemaInput {
  snapshot: Snapshot;
  datasets: readonly CompatibilityDatasetInstance[];
}

export type DatasetSchemaCompatibilityDiagnosticCode =
  | 'MissingDatasetSource'
  | 'MissingDimensionColumn'
  | 'MissingMeasureField'
  | 'MissingTenantKey'
  | 'MissingTimeKey'
  | 'InvalidMeasureFilterField'
  | 'IncompatibleNumericMeasureType'
  | 'MissingRelationshipSourceColumn'
  | 'MissingRelationshipTargetSource'
  | 'MissingRelationshipTargetColumn'
  | 'LimitedSqlExpressionCompatibility';

export interface DatasetSchemaCompatibilityDiagnostic {
  level: 'error' | 'warning';
  code: DatasetSchemaCompatibilityDiagnosticCode;
  datasetName: string;
  fieldName?: string;
  physicalColumnName?: string;
  sourceName?: string;
  message: string;
}

export interface DatasetSchemaCompatibilityReport {
  valid: boolean;
  diagnostics: DatasetSchemaCompatibilityDiagnostic[];
}

export interface SemanticCompatibilityPlanOptions {
  datasets: readonly CompatibilityDatasetInstance[];
}
