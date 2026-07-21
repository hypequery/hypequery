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

// Telemetry (anonymous, opt-out; see design doc privacy rules)
export { Telemetry, anonymize, durationBucket, UI_EVENT_ALLOWLIST } from './telemetry.js';
export type { TelemetryEvent, TelemetryOptions } from './telemetry.js';

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

/**
 * Lower-level building blocks for advanced composition and testing.
 *
 * @security These exports do not authenticate requests. Prefer `createGateway`
 * for the secure loopback/token/session guard, or apply equivalent
 * authentication before dispatching to them directly.
 */
export { DevHandler, createDevHandler } from './dev-handler.js';
export type { DevHandlerOptions } from './dev-handler.js';
export { DevAPIRouter, createDevRouter } from './api/router.js';
export type { RouterOptions } from './api/router.js';
export { SSEHandler } from './api/sse-handler.js';
export type { SSEEvent } from './api/sse-handler.js';
