import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import type { SSEHandler } from './sse-handler.js';
import type { CacheStore } from '../../cache/types.js';

/**
 * Context passed to endpoint handlers.
 */
export interface EndpointContext {
  store: QueryHistoryStore;
  req: IncomingMessage;
  res: ServerResponse;
  logger?: DevQueryLogger;
  /** Serve-layer cache store for real-time cache stats and operations */
  serveCacheStore?: CacheStore;
  sseHandler?: SSEHandler;
  api?: ApiInstance;
}

/**
 * Minimal API instance interface for available queries.
 */
export interface ApiInstance {
  endpoints?: Record<string, EndpointDefinition>;
  execute?: (key: string, options: { input?: unknown }) => Promise<unknown>;
}

export interface EndpointDefinition {
  key?: string;
  path?: string;
  method?: string;
  description?: string;
  tags?: string[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  metadata?: {
    path?: string;
    method?: string;
    name?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    requiresAuth?: boolean;
    requiredRoles?: string[];
    requiredScopes?: string[];
    cacheTtlMs?: number | null;
    visibility?: string;
    custom?: Record<string, unknown>;
  };
  tenant?: unknown;
  cacheTtlMs?: number | null;
}

/**
 * Registry entry for the dev UI.
 */
export interface RegistryEntry {
  key: string;
  name?: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  hasInput: boolean;
  inputFields?: string[];
  hasTenant: boolean;
  isCached: boolean;
  cacheTtlMs?: number;
  requiresAuth: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  visibility?: string;
  custom?: Record<string, unknown>;
}
