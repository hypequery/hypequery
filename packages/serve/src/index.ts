export * from "./types.js";
export * from "./query-logger.js";
export * from "./server/index.js";
export * from "./router.js";
export * from "./endpoint.js";
export * from "./openapi.js";
export * from "./docs-ui.js";
export * from "./auth.js";
export * from "./cors.js";
export * from "./errors.js";
export * from "./rate-limit.js";
export * from "./client-config.js";
export * from "./utils.js";
export * from "./adapters/node.js";
export * from "./adapters/fetch.js";
export * from "./adapters/vercel.js";
export { startServer, toNodeHandler, toFetchHandler } from "./adapters/standalone.js";
export type { DevIntegrationApi, ServeDevOptions } from "./dev.js";
export { createCacheObservability, detectBuilderCache } from "./cache-observability.js";
export type { CacheObservability, CacheLayerStats, BuilderCacheLike } from "./cache-observability.js";
/**
 * Re-exported from `@hypequery/datasets`, where it now lives beside the schema
 * builders it converts. Kept here because it is a shipped export of this
 * package and removing it would break importers for no benefit.
 */
export { ProtocolSchemaAdapterError, zodToProtocolSchema } from '@hypequery/datasets';
/** @deprecated Import from `@hypequery/serve/dev` instead. */
export { serveDev } from "./dev.js";
export * from "./serve.js";
export * from "./semantic/index.js";

// MCP tooling seam: lets `hypequery mcp` reuse this entrypoint's datasets.
export { readServeMcpSource } from './server/mcp-source.js';
export type { ServeMcpSource } from './server/mcp-source.js';
