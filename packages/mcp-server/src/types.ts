/**
 * Type definitions for MCP Server
 */

import type {
  AnyDatasetInstance,
  MetricFilter,
  TimeGrain,
  MetricOrderBy,
} from '@hypequery/datasets';

/**
 * Registry of datasets - maps dataset names to dataset instances
 */
export type DatasetRegistry = Record<string, AnyDatasetInstance | Record<string, unknown>>;

/**
 * Arguments for query_metric tool
 */
export interface QueryMetricArgs {
  dataset: string;
  metric: string;
  dimensions?: string[];
  filters?: MetricFilter[];
  grain?: TimeGrain;
  orderBy?: MetricOrderBy[];
  limit?: number;
  offset?: number;
}

/**
 * Arguments for query_dataset tool
 */
export interface QueryDatasetArgs {
  dataset: string;
  dimensions?: string[];
  metrics?: string[];
  filters?: MetricFilter[];
  grain?: TimeGrain;
  orderBy?: MetricOrderBy[];
  limit?: number;
  offset?: number;
}

export interface QueryToolOptions {
  tenantId?: string;
}

/**
 * Arguments for get_dataset_schema tool
 */
export interface GetDatasetSchemaArgs {
  dataset: string;
}

/**
 * MCP tool response format
 * Matches the MCP SDK CallToolResult type
 */
export interface MCPToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;  // Allow additional properties for MCP protocol
}

/**
 * Dataset schema response structure
 */
export interface DatasetSchema {
  name: string;
  description: string;
  source: string;
  timeKey: string | null;
  tenantKey: string | null;
  dimensions: Record<string, DimensionSchema>;
  measures: Record<string, MeasureSchema>;
  metrics: Record<string, MetricSchema>;
  filters: Record<string, FilterSchema>;
  relationships: Record<string, RelationshipSchema>;
  limits?: {
    maxDimensions?: number;
    maxMeasures?: number;
    maxFilters?: number;
    maxResultSize?: number;
  };
}

/**
 * Dimension schema in response
 */
export interface DimensionSchema {
  type: string;
  column: string | null;
  sql: string | null;
  label: string;
  description: string;
  examples: string[];
  filterable: boolean;
  groupable: boolean;
}

/**
 * Measure schema in response
 */
export interface MeasureSchema {
  aggregation: string;
  field: string;
  sql: string | null;
  label: string;
  description: string;
}

/**
 * Filter schema in response
 */
export interface FilterSchema {
  field: string;
  label: string;
  description: string;
  operators: string[] | null;
}

/**
 * Metric schema in response
 */
export interface MetricSchema {
  type: string;
  aggregation: string;
  label: string;
  description: string;
  format: string | null;
}

/**
 * Relationship schema in response
 */
export interface RelationshipSchema {
  type: string;
  target: string;
  from?: string;
  to?: string;
  execution?: string;
  description: string;
}

/**
 * Dataset list item
 */
export interface DatasetListItem {
  name: string;
  description: string;
  dimensionCount: number;
  measureCount?: number;
  metricCount: number;
}

/**
 * Datasets list response
 */
export interface DatasetsListResponse {
  datasets: DatasetListItem[];
  total: number;
}

/**
 * Query result metadata
 */
export interface QueryResultMeta {
  sql?: string;
  timingMs?: number;
  rowCount: number;
  /**
   * Offset pagination state. Present when the query specified a `limit`.
   * `hasMore` lets callers know whether to request the next `offset` page.
   */
  pagination?: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Query result response
 */
export interface QueryResultResponse {
  data: Record<string, unknown>[];
  meta: QueryResultMeta;
}

/**
 * Constants
 */
export const MAX_QUERY_LIMIT = 10000;
export const DEFAULT_QUERY_LIMIT = 100;
