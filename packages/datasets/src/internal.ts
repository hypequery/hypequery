/**
 * Internal APIs for @hypequery/serve package only.
 *
 * These exports are NOT part of the public API and should not be used
 * by end users. They are implementation details that the serve package
 * needs to create endpoints.
 *
 * DO NOT import from this file in user code!
 */

// Executor - used by serve to create metric/dataset endpoints
export { createExecutor, SemanticExecutor } from './executor.js';
export type { SemanticExecutorOptions } from './executor.js';
export { createInMemoryBackend } from './in-memory-backend.js';
export type { InMemoryTable, InMemoryTables } from './in-memory-backend.js';
export type {
  PlanNode,
  SemanticBackend,
  SemanticBackendResult,
  SemanticExpression,
  SemanticAggregationPlan,
  SemanticDimensionPlan,
  SemanticGrainPlan,
} from './semantic-plan.js';

// Validation - used by serve for query validation
export type { ValidationResult } from './validation.js';
export { validateFilterValue, matchesFieldType } from './validation.js';

// Constants - used by serve
export { GRAIN_FUNCTIONS } from './constants.js';

// Additional types that serve needs
export type {
  AnyDatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
} from './types.js';
