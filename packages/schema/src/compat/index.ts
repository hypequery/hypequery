export {
  checkDatasetsAgainstSchema,
  createSemanticCompatibilityAnalyzer,
} from './check.js';

export type {
  CheckDatasetsAgainstSchemaInput,
  CompatibilityDatasetInstance,
  CompatibilityDimensionDefinition,
  CompatibilityMeasureDefinition,
  CompatibilityMetricFilter,
  CompatibilitySemanticFilterDefinition,
  DatasetSchemaCompatibilityDiagnostic,
  DatasetSchemaCompatibilityDiagnosticCode,
  DatasetSchemaCompatibilityReport,
  SemanticCompatibilityPlanOptions,
} from './types.js';
