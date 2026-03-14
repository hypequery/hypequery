// ---------------------------------------------------------------------------
// Legacy semantic layer (v1) — defineModel + dataset query builder
// ---------------------------------------------------------------------------
export { defineModel } from './model.js';
export { dataset as datasetQuery } from './dataset.js';
export type { InferDatasetResult, DatasetBuilder } from './dataset.js';
export type {
  SemanticSchema,
  DimensionType,
  InferDimensionType,
  DimensionDefinition,
  DimensionsDefinition,
  MeasureAggregation,
  MeasureDefinition,
  MeasuresDefinition,
  RelationshipType,
  RelationshipDefinition as LegacyRelationshipDefinition,
  RelationshipsDefinition,
  ModelConfig,
  Model,
  ModelRegistry,
  DatasetFilter,
  DatasetOrderBy,
  DatasetConfig as LegacyDatasetConfig,
  DatasetInclude,
  InferDimensionRow,
  InferMeasureRow,
  InferDatasetRow,
} from './types.js';

// ---------------------------------------------------------------------------
// Datasets & Metrics API (v2)
// ---------------------------------------------------------------------------
export * from './datasets/index.js';
