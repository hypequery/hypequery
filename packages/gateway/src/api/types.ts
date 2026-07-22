import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import type { SSEHandler } from './sse-handler.js';
import type { CacheObservability, DevIntegrationApi, GatewayCapability } from '../types.js';
import type { Telemetry } from '../telemetry.js';
export type { RegistryEntry } from '@hypequery/gateway-contract';

/**
 * Context passed to endpoint handlers.
 */
export interface EndpointContext {
  store: QueryHistoryStore;
  req: IncomingMessage;
  res: ServerResponse;
  logger?: DevQueryLogger;
  /** Per-layer cache stats/clear from serve's DevIntegrationApi. */
  cacheObservability?: CacheObservability;
  sseHandler?: SSEHandler;
  /** The serve API the gateway drives (registry + execution). */
  api?: DevIntegrationApi;
  /** Capabilities advertised via /meta, derived from what the gateway was given. */
  capabilities: GatewayCapability[];
  /** Project name surfaced in /meta. */
  projectName?: string;
  /** Anonymous usage telemetry (no-op unless enabled). */
  telemetry?: Telemetry;
}
