/**
 * @hypequery/mcp
 *
 * Model Context Protocol (MCP) server for Hypequery semantic layer.
 * Exposes datasets and metrics to AI agents via MCP tools.
 */

export { HypequeryMCPServer, createMCPServer, type MCPServerConfig } from './server.js';
export {
  HypequeryMCPExecutor,
  createMCPExecutor,
  type MCPExecutorConfig,
  type MCPToolExecutor,
} from './executor.js';
export {
  HypequeryMCPProtocolServer,
  createMCPProtocolServer,
  type MCPProtocolServerOptions,
} from './protocol-server.js';
export { connectMCPServerStdio, startStdioMCPServer } from './stdio.js';
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
  MCPExecutionBudget,
  MCPQueryLimits,
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
export {
  MCPExecutionBudgetError,
  MCPToolError,
  classifyMCPToolError,
  formatMCPToolError,
  type MCPErrorDetails,
  type MCPExecutionErrorCode,
  type MCPToolErrorCode,
  type MCPToolErrorCategory,
} from './errors.js';
export {
  MAX_QUERY_LIMIT,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_OFFSET,
  MAX_QUERY_DIMENSIONS,
  MAX_QUERY_MEASURES,
  MAX_QUERY_FILTERS,
  MAX_QUERY_ORDER_BY,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_QUERY_TIMEOUT_MS,
  DEFAULT_RESPONSE_BYTES,
  MAX_RESPONSE_BYTES,
} from './types.js';
export { MCP_PACKAGE_VERSION } from './version.js';
