/**
 * @hypequery/mcp-server
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
