/**
 * @hypequery/mcp
 *
 * Model Context Protocol (MCP) server for Hypequery semantic layer.
 * Exposes datasets and metrics to AI agents via MCP tools.
 */

export { HypequeryMCPServer, createMCPServer, type MCPServerConfig } from './server.js';
export { listDatasetsTool } from './tools/list-datasets.js';
export { getDatasetSchemaTool } from './tools/introspect.js';
export { queryMetricTool } from './tools/query-metric.js';
export { queryDatasetTool } from './tools/query-dataset.js';
export { datasetGuidePrompt } from './prompts/dataset-guide.js';

// Export types
export type {
  DatasetRegistry,
  QueryMetricArgs,
  QueryDatasetArgs,
  QueryToolOptions,
  SchemaToolOptions,
  GetDatasetSchemaArgs,
  MCPToolResponse,
  DatasetSchema,
  DimensionSchema,
  MetricSchema,
  RelationshipSchema,
  DatasetListItem,
  DatasetsListResponse,
  QueryResultResponse,
  QueryResultMeta,
} from './types.js';
export { MAX_QUERY_LIMIT, DEFAULT_QUERY_LIMIT } from './types.js';
