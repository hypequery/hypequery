/**
 * Type definitions for MCP Server
 */

import type {
  AgentCatalogDataset,
  AgentCatalogDimension,
  AgentCatalogFilter,
  AgentCatalogMeasure,
  AgentCatalogMetric,
  AgentCatalogRelationship,
  AnyDatasetInstance,
  MetricFilter,
  TimeGrain,
  MetricOrderBy,
} from '@hypequery/datasets';
import type { ZodTypeAny } from 'zod';

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
  measures?: string[];
  filters?: MetricFilter[];
  grain?: TimeGrain;
  orderBy?: MetricOrderBy[];
  limit?: number;
  offset?: number;
}

export interface QueryToolOptions {
  tenantId?: string;
  includeSql?: boolean;
  limits?: MCPQueryLimits;
  executionBudget?: MCPExecutionBudget;
  signal?: AbortSignal;
  /** Canonical catalog-derived validator supplied by the owning server. */
  inputSchema?: ZodTypeAny;
}

/** Per-query wall-clock and serialized-response ceilings. */
export interface MCPExecutionBudget {
  /** Maximum query duration in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum UTF-8 bytes in the serialized query response. Defaults to 1 MiB. */
  maxResponseBytes?: number;
}

/**
 * Ceilings on the tool manifest itself, rather than on any one call.
 *
 * Every other budget here bounds a query. This one bounds what a client is
 * handed before it makes one: `query_dataset` and `query_metric` carry exact
 * enums of every published dataset, dimension, measure, and filter field, so a
 * large catalog produces a large manifest — paid by every client on every
 * connection, and spent out of the model's context before a question is asked.
 *
 * A breach raises `MCPCatalogBudgetError`. It is not truncated: an agent shown
 * fewer targets than the validators accept would be misled, and the manifest
 * hash would no longer identify the catalog behind it.
 */
export interface MCPCatalogBudget {
  /**
   * Maximum tools a manifest may advertise. Defaults to 64, ceiling 256.
   *
   * The local server publishes a fixed four. This exists for the hosted tool
   * modes that publish one tool per dataset or per verified metric, where the
   * count follows the catalog and needs a stop.
   */
  maxTools?: number;
  /**
   * Maximum UTF-8 bytes in the serialized manifest. Defaults to 256 KiB,
   * ceiling 1 MiB.
   */
  maxManifestBytes?: number;
}

/** Server-side ceilings applied in addition to Dataset limits. */
export interface MCPQueryLimits {
  /** Rows used when a tool call omits `limit`. Defaults to 100. */
  defaultResultSize?: number;
  /** Maximum explicit or default row limit. Cannot exceed 10,000. */
  maxResultSize?: number;
  /** Maximum pagination offset. Cannot exceed 10,000. */
  maxOffset?: number;
  /** Maximum selected dimensions. Cannot exceed 50. */
  maxDimensions?: number;
  /** Maximum selected measures. Cannot exceed 50. */
  maxMeasures?: number;
  /** Maximum filters. Cannot exceed 100. */
  maxFilters?: number;
  /** Maximum order clauses. Cannot exceed 50. */
  maxOrderBy?: number;
}

export interface SchemaToolOptions {
  /** @deprecated Agent-facing introspection is always safe. Use getTrustedDatasetSchema separately. */
  includeSql?: boolean;
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
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;  // Allow additional properties for MCP protocol
}

/**
 * Dataset schema response structure
 */
export type DatasetSchema = AgentCatalogDataset;

/**
 * Dimension schema in response
 */
export type DimensionSchema = AgentCatalogDimension;

/**
 * Measure schema in response
 */
export type MeasureSchema = AgentCatalogMeasure;

/**
 * Filter schema in response
 */
export type FilterSchema = AgentCatalogFilter;

/**
 * Metric schema in response
 */
export type MetricSchema = AgentCatalogMetric;

/**
 * Relationship schema in response
 */
export type RelationshipSchema = AgentCatalogRelationship;

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
  /** Cache outcome for agent observability. */
  cache?: {
    status: 'hit' | 'miss' | 'bypass';
    ageMs?: number;
    stale?: boolean;
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
export const MAX_QUERY_OFFSET = 10000;
export const MAX_QUERY_DIMENSIONS = 50;
export const MAX_QUERY_MEASURES = 50;
export const MAX_QUERY_FILTERS = 100;
export const MAX_QUERY_ORDER_BY = 50;
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const MAX_QUERY_TIMEOUT_MS = 120_000;
export const DEFAULT_RESPONSE_BYTES = 1_048_576;
export const MAX_RESPONSE_BYTES = 10_485_760;
export const DEFAULT_MANIFEST_TOOLS = 64;
export const MAX_MANIFEST_TOOLS = 256;
export const DEFAULT_MANIFEST_BYTES = 262_144;
export const MAX_MANIFEST_BYTES = 1_048_576;
