/**
 * `@hypequery/datasets/schemas`: Zod-backed query schemas and agent tools.
 *
 * Everything here builds or reads Zod schemas. It lives apart from the root
 * entry so that defining and querying datasets never loads Zod. In 1.0 the
 * root entry stops re-exporting these and Zod becomes an optional peer
 * dependency needed only by this entry.
 */

// Agent/tool metadata
export {
  generateDatasetTools,
  toOpenAITools,
  toAISDKTools,
  toMcpTools,
} from './tools.js';
export type {
  AISDKToolDefinition,
  DatasetToolAnalytics,
  DatasetToolMode,
  GenerateDatasetToolsOptions,
  JsonSchema,
  McpToolDefinition,
  OpenAIToolDefinition,
  SemanticToolDefinition,
} from './tools.js';

// Canonical semantic query schemas shared by Serve, MCP, and agent adapters.
export {
  buildDatasetInputSchema,
  buildMetricInputSchema,
  buildCanonicalSemanticQuerySchemas,
  toSemanticJsonSchema,
  DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS,
  buildDatasetInputProtocolSchema,
  buildMetricInputProtocolSchema,
} from './semantic-query-schema.js';
export type {
  CanonicalSemanticQuerySchemas,
  SemanticMetricQueryContract,
  SemanticQuerySchemaLimits,
  SemanticQuerySchemaOptions,
  SemanticQuerySchemaSource,
} from './semantic-query-schema.js';

// Zod to RFC 0004 protocol schemas, for Zod 3 or Zod 4 input.
export { ProtocolSchemaAdapterError, zodToProtocolSchema } from './protocol-schema-adapter.js';
export type { AnyZodSchema } from './utils/zod-schema-version.js';

// Client-contract query schemas.
export { buildClientContractQuerySchemas } from './client-contract/query-schema.js';
export type { ClientContractQuerySchemas, ClientEndpointQuerySchema } from './client-contract/query-schema.js';
