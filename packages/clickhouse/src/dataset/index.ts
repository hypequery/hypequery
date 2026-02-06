/**
 * Dataset API Module
 *
 * Provides a declarative API for defining dynamic datasets with:
 * - Type-safe dimension and metric definitions
 * - SQL expression support via tagged templates
 * - Helper functions for common patterns
 * - Introspection for AI agents
 * - Full TypeScript type inference
 *
 * @module @hypequery/clickhouse/dataset
 *
 * @example
 * ```typescript
 * import { sql, dimension, metric } from '@hypequery/clickhouse/dataset';
 *
 * const datasets = {
 *   orders: {
 *     name: 'orders',
 *     description: 'Customer orders and revenue data',
 *     table: 'orders',
 *     dimensions: {
 *       region: dimension.string('region', {
 *         description: 'Geographic region',
 *         examples: ['US', 'EU', 'APAC']
 *       }),
 *       date: dimension.date(sql`DATE(created_at)`, {
 *         description: 'Order date'
 *       })
 *     },
 *     metrics: {
 *       revenue: metric.sum('amount', {
 *         description: 'Total revenue',
 *         format: 'currency'
 *       }),
 *       orderCount: metric.count({
 *         description: 'Number of orders'
 *       })
 *     }
 *   }
 * };
 * ```
 */

// =============================================================================
// SQL TAGGED TEMPLATE
// =============================================================================

export { sql, isSQLExpression, toSQLString } from './sql-tag.js';
export type { SQLExpression } from './sql-tag.js';

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Dimension types
  DimensionType,
  SimpleDimension,
  DimensionDefinition,
  Dimension,
  DimensionsMap,

  // Metric types
  MetricAggregationType,
  MetricFormat,
  MetricDefinition,
  MetricsMap,

  // Dataset types
  DatasetDefinition,
  DatasetsMap,
  TenantConfig,
  DatasetLimits,

  // Filter types
  FilterOperator,
  DateRangeValue,
  FilterValue,
  FilterDefinition,
  Filters,

  // Order types
  SortDirection,
  OrderByDimension,
  OrderByMetric,
  OrderBy,

  // Cache types
  CacheOptions,

  // Query types
  DatasetQuery,
  QueryContext,
  QueryResultMetadata,
  QueryResult,

  // Type inference
  InferDimensionType,
  InferMetricType,
  InferQueryRowType,
  InferQueryResult,

  // Introspection types
  IntrospectedDimension,
  IntrospectedMetric,
  IntrospectedDataset,
} from './types.js';

// =============================================================================
// HELPERS
// =============================================================================

export { dimension, metric } from './helpers.js';
export type { DimensionOptions, MetricOptions } from './helpers.js';

// =============================================================================
// DEFINITION UTILITIES
// =============================================================================

export {
  validateDatasetDefinition,
  validateDatasets,
  normalizeDimension,
  normalizeDimensions,
  inferDimensionType,
  getDimensionSQL,
  getMetricSQL,
  getDataset,
  listDatasets,
  hasDataset,
  getDimensionNames,
  getMetricNames,
  hasDimension,
  hasMetric,
  getDimension,
  getMetric,
} from './definition.js';

// =============================================================================
// INTROSPECTION
// =============================================================================

export {
  introspectDimension,
  introspectMetric,
  getDatasetSchema,
  listDatasets as listDatasetSchemas,
  getAllDatasetSchemas,
  summarizeDataset,
  datasetsToJSON,
  summarizeAllDatasets,
} from './introspection.js';
