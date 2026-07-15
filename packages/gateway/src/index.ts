/**
 * @hypequery/gateway — local hypequery gateway.
 *
 * Implements the gateway contract (plans/gateway-contract.md) over a serve API
 * and serves the @hypequery/studio UI same-origin at /__dev.
 */

// Primary entry
export { createGateway } from './gateway.js';
export type { Gateway, CreateGatewayOptions } from './gateway.js';

// Contract
export { CONTRACT_VERSION } from './api/meta-endpoints.js';
export type { GatewayCapability, CacheObservability, CacheStatsSnapshot, DevIntegrationApi } from './types.js';

// Storage
export * from './storage/index.js';

// Query logger
export { DevQueryLogger } from './query-logger.js';
export type {
  LoggerStats,
  QueryLogEvent,
  QueryLogEventCallback,
  DevQueryLoggerOptions
} from './query-logger.js';

// Lower-level building blocks (for advanced composition / testing)
export { DevHandler, createDevHandler } from './dev-handler.js';
export type { DevHandlerOptions } from './dev-handler.js';
export { DevAPIRouter, createDevRouter } from './api/router.js';
export type { RouterOptions } from './api/router.js';
export { SSEHandler } from './api/sse-handler.js';
export type { SSEEvent } from './api/sse-handler.js';
