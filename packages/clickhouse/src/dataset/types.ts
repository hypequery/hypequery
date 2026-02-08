/**
 * Dataset API Type Definitions
 *
 * Comprehensive type system for the dataset API, including:
 * - Dataset definitions
 * - Dimension and metric types
 * - Filter operators and types
 * - Query execution types
 * - Type inference utilities
 */

import type { SQLExpression } from './sql-tag.js';

// =============================================================================
// DIMENSION TYPES
// =============================================================================

/**
 * Dimension value types
 */
export type DimensionType = 'string' | 'number' | 'date' | 'boolean';

/**
 * Simple dimension definition (column name as string)
 */
export type SimpleDimension = string;

/**
 * Complex dimension definition with metadata
 */
export interface DimensionDefinition {
  /** SQL expression or column name */
  sql: string | SQLExpression;
  /** Data type of the dimension */
  type: DimensionType;
  /** Human-readable description (for AI agents) */
  description: string;
  /** Example values (for AI context) */
  examples?: string[];
  /** Whether this dimension requires a join */
  join?: string;
}

/**
 * Dimension definition (simple or complex)
 */
export type Dimension = SimpleDimension | SQLExpression | DimensionDefinition;

/**
 * Map of dimension names to definitions
 */
export type DimensionsMap = Record<string, Dimension>;

// =============================================================================
// METRIC TYPES
// =============================================================================

/**
 * Supported metric aggregation types
 */
export type MetricAggregationType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'custom';

/**
 * Metric format hints
 */
export type MetricFormat = 'currency' | 'percent' | 'number' | 'bytes';

/**
 * Metric definition
 */
export interface MetricDefinition {
  /** Aggregation type */
  type: MetricAggregationType;
  /** SQL expression or column name */
  sql: string | SQLExpression;
  /** Human-readable description (for AI agents) */
  description: string;
  /** Format hint for display */
  format?: MetricFormat;
  /** Whether this metric requires a join */
  join?: string;
  /** Allow fan-out (for oneToMany joins) - advanced use only */
  allowFanout?: boolean;
}

/**
 * Map of metric names to definitions
 */
export type MetricsMap = Record<string, MetricDefinition>;

// =============================================================================
// TENANT CONFIGURATION
// =============================================================================

/**
 * Multi-tenancy configuration
 */
export interface TenantConfig {
  /** Column name for tenant isolation */
  column: string;
  /** Whether tenant filtering is required */
  required?: boolean;
}

// =============================================================================
// COMPLEXITY GUARDRAILS
// =============================================================================

/**
 * Complexity limits to prevent expensive queries
 */
export interface DatasetLimits {
  /** Maximum number of dimensions in a query */
  maxDimensions?: number;
  /** Maximum number of metrics in a query */
  maxMetrics?: number;
  /** Maximum number of filters in a query */
  maxFilters?: number;
  /** Maximum result set size */
  maxResultSize?: number;
}

// =============================================================================
// DATASET DEFINITION
// =============================================================================

/**
 * Complete dataset definition
 */
export interface DatasetDefinition<
  TDimensions extends DimensionsMap = DimensionsMap,
  TMetrics extends MetricsMap = MetricsMap
> {
  /** Unique dataset name */
  name: string;
  /** Human-readable description (for AI agents) */
  description: string;
  /** Source table name */
  table: string;
  /** Schema type (for type inference) */
  schema?: unknown;
  /** Dimension definitions */
  dimensions: TDimensions;
  /** Metric definitions */
  metrics: TMetrics;
  /** Multi-tenancy configuration */
  tenant?: TenantConfig;
  /** Complexity guardrails */
  limits?: DatasetLimits;
}

/**
 * Map of dataset names to definitions
 */
export type DatasetsMap = Record<string, DatasetDefinition>;

// =============================================================================
// FILTER TYPES
// =============================================================================

/**
 * Filter operator types
 */
export type FilterOperator =
  | 'eq'           // Equal
  | 'ne'           // Not equal
  | 'gt'           // Greater than
  | 'lt'           // Less than
  | 'gte'          // Greater than or equal
  | 'lte'          // Less than or equal
  | 'in'           // In array
  | 'notIn'        // Not in array
  | 'between'      // Between two values
  | 'like'         // Pattern match
  | 'notLike'      // Not pattern match
  | 'isNull'       // Is NULL
  | 'isNotNull'    // Is NOT NULL
  | 'inDateRange'; // Date range helper

/**
 * Date range helper values
 */
export type DateRangeValue =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | { start: string; end: string };

/**
 * Filter value type based on operator
 */
export type FilterValue<TOperator extends FilterOperator = FilterOperator> =
  TOperator extends 'in' | 'notIn'
    ? unknown[]
    : TOperator extends 'between'
    ? [unknown, unknown]
    : TOperator extends 'isNull' | 'isNotNull'
    ? never
    : TOperator extends 'inDateRange'
    ? DateRangeValue
    : unknown;

/**
 * Filter definition
 */
export interface FilterDefinition<TOperator extends FilterOperator = FilterOperator> {
  /** Dimension to filter on */
  dimension: string;
  /** Filter operator */
  operator: TOperator;
  /** Filter value (type depends on operator) */
  value?: FilterValue<TOperator>;
}

/**
 * Array of filters
 */
export type Filters = FilterDefinition[];

// =============================================================================
// ORDER TYPES
// =============================================================================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Order by dimension
 */
export interface OrderByDimension {
  dimension: string;
  direction: SortDirection;
}

/**
 * Order by metric
 */
export interface OrderByMetric {
  metric: string;
  direction: SortDirection;
}

/**
 * Order definition (dimension or metric)
 */
export type OrderBy = OrderByDimension | OrderByMetric;

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

/**
 * Cache options for query results
 */
export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl?: number;
  /** Custom cache key */
  key?: string;
}

// =============================================================================
// QUERY DEFINITION
// =============================================================================

/**
 * Dataset query definition
 */
export interface DatasetQuery<
  TDataset extends DatasetDefinition = DatasetDefinition
> {
  /** Dimensions to include in the query */
  dimensions: Array<keyof TDataset['dimensions'] & string>;
  /** Metrics to include in the query */
  metrics: Array<keyof TDataset['metrics'] & string>;
  /** Filters to apply */
  filters?: Filters;
  /** Ordering */
  order?: OrderBy[];
  /** Result limit */
  limit?: number;
  /** Result offset (for pagination) */
  offset?: number;
  /** Cache options */
  cache?: CacheOptions;
}

// =============================================================================
// QUERY EXECUTION CONTEXT
// =============================================================================

/**
 * Query execution context (for multi-tenancy)
 */
export interface QueryContext {
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
}

// =============================================================================
// QUERY RESULT TYPES
// =============================================================================

/**
 * Query result metadata
 */
export interface QueryResultMetadata {
  /** Dimensions included in the result */
  dimensions: string[];
  /** Metrics included in the result */
  metrics: string[];
  /** Number of rows returned */
  rowCount: number;
  /** Whether the result was served from cache */
  cached: boolean;
  /** Execution time in milliseconds */
  executionTime?: number;
  /** Generated SQL query */
  sql?: string;
}

/**
 * Query result
 */
export interface QueryResult<TRow = Record<string, unknown>> {
  /** Result data */
  data: TRow[];
  /** Result metadata */
  metadata: QueryResultMetadata;
}

// =============================================================================
// TYPE INFERENCE UTILITIES
// =============================================================================

/**
 * Infer the TypeScript type from a dimension definition
 */
export type InferDimensionType<T> = T extends string
  ? string // Simple column reference
  : T extends SQLExpression
  ? unknown // SQL expression (type unknown without further analysis)
  : T extends DimensionDefinition
  ? T['type'] extends 'string'
    ? string
    : T['type'] extends 'number'
    ? number
    : T['type'] extends 'date'
    ? Date
    : T['type'] extends 'boolean'
    ? boolean
    : unknown
  : unknown;

/**
 * Infer the TypeScript type from a metric definition
 * All metrics return numbers
 */
export type InferMetricType<T> = T extends MetricDefinition ? number : number;

/**
 * Infer the row type from a dataset query
 */
export type InferQueryRowType<
  TDataset extends DatasetDefinition,
  TDimensions extends Array<keyof TDataset['dimensions'] & string>,
  TMetrics extends Array<keyof TDataset['metrics'] & string>
> = {
  [K in TDimensions[number]]: InferDimensionType<TDataset['dimensions'][K]>;
} & {
  [K in TMetrics[number]]: InferMetricType<TDataset['metrics'][K]>;
};

/**
 * Infer the complete result type from a dataset query
 */
export type InferQueryResult<
  TDataset extends DatasetDefinition,
  TQuery extends DatasetQuery<TDataset>
> = QueryResult<InferQueryRowType<TDataset, TQuery['dimensions'], TQuery['metrics']>>;

// =============================================================================
// INTROSPECTION TYPES
// =============================================================================

/**
 * Introspected dimension schema (for AI agents)
 */
export interface IntrospectedDimension {
  /** Dimension type */
  type: DimensionType;
  /** Human-readable description */
  description?: string;
  /** Example values */
  examples?: string[];
  /** SQL expression */
  sql: string;
}

/**
 * Introspected metric schema (for AI agents)
 */
export interface IntrospectedMetric {
  /** Always 'number' for metrics */
  type: 'number';
  /** Aggregation type */
  aggregationType: MetricAggregationType;
  /** Human-readable description */
  description: string;
  /** Format hint */
  format?: MetricFormat;
  /** SQL expression */
  sql: string;
}

/**
 * Introspected dataset schema (for AI agents)
 */
export interface IntrospectedDataset {
  /** Dataset name */
  name: string;
  /** Dataset description */
  description: string;
  /** Source table */
  table: string;
  /** Introspected dimensions */
  dimensions: Record<string, IntrospectedDimension>;
  /** Introspected metrics */
  metrics: Record<string, IntrospectedMetric>;
  /** Whether multi-tenancy is required */
  tenantRequired?: boolean;
  /** Complexity limits */
  limits?: DatasetLimits;
}
