import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import type { SSEHandler } from './sse-handler.js';
import type { CacheObservability, DevIntegrationApi, GatewayCapability } from '../types.js';

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
}

/**
 * Registry entry returned by GET /__dev/registry — one per serve endpoint,
 * mapped from serve's `describe()` (`ToolkitQueryDescription`).
 */
export interface RegistryEntry {
  key: string;
  name?: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  hasInput: boolean;
  hasTenant: boolean;
  requiresAuth: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  visibility?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  custom?: Record<string, unknown>;
}
