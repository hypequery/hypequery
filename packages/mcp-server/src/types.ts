/**
 * Type definitions for MCP Server
 */

import type {
  MetricFilter,
  TimeGrain,
  MetricOrderBy,
} from '@hypequery/datasets';

/**
 * Registry of datasets - maps dataset names to dataset instances
 * Using flexible type to accommodate actual dataset structure
 */
export type DatasetRegistry = Record<string, Record<string, unknown>>;

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
  metrics: Record<string, MetricSchema>;
  relationships: Record<string, RelationshipSchema>;
}

/**
 * Dimension schema in response
 */
export interface DimensionSchema {
  type: string;
  column: string;
  label: string;
  description: string;
  examples: string[];
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
  description: string;
}

/**
 * Dataset list item
 */
export interface DatasetListItem {
  name: string;
  description: string;
  dimensionCount: number;
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
