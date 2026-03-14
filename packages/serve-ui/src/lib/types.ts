/**
 * Cache status from serve-layer caching.
 */
export type CacheStatus = 'hit' | 'miss' | 'stale' | 'bypass';

/**
 * Timing breakdown for query execution.
 */
export interface QueryTimingBreakdown {
  /** Time to resolve middleware and prepare context (ms) */
  setupMs?: number;
  /** Time to execute the actual query/handler (ms) */
  handlerMs?: number;
  /** Time to serialize and prepare response (ms) */
  serializeMs?: number;
}

/**
 * Query history entry from the dev server.
 */
export interface QueryHistoryEntry {
  id?: number;
  queryId: string;
  query: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
  rowCount?: number;
  /** @deprecated Use cacheStatus instead */
  cacheHit?: boolean;
  /** Cache status: hit, miss, stale, or bypass */
  cacheStatus?: CacheStatus;
  cacheAgeMs?: number;
  cacheKey?: string;
  endpointKey?: string;
  endpointPath?: string;
  resultPreview?: unknown[];
  createdAt?: number;
  /** Tenant ID if multi-tenancy is enabled */
  tenantId?: string;
  /** Timing breakdown */
  timing?: QueryTimingBreakdown;
}

/**
 * Cache statistics snapshot from serve-layer cache.
 */
export interface CacheStats {
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Total stale hits (served stale while revalidating) */
  staleHits?: number;
  /** Total queries that bypassed cache */
  bypassed?: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total queries through cache layer */
  totalQueries: number;
  /** Average age of cache hits in ms */
  avgCacheAge: number;
  /** Number of entries currently in cache */
  entryCount?: number;
  /** Approximate memory usage in bytes */
  memoryBytes?: number;
}

/**
 * Available API endpoint info.
 */
export interface AvailableEndpoint {
  key: string;
  path?: string;
  method?: string;
  description?: string;
  tags?: string[];
}

/**
 * Registry entry for an endpoint.
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

/**
 * Registry response from the API.
 */
export interface RegistryResponse {
  entries: RegistryEntry[];
  total: number;
}

/**
 * Logger statistics.
 */
export interface LoggerStats {
  totalLogged: number;
  queueSize: number;
  isProcessing: boolean;
  lastFlush?: number;
}

/**
 * Paginated query result.
 */
export interface QueryListResult {
  queries: QueryHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Query filter options.
 */
export interface QueryFilters {
  status?: 'pending' | 'running' | 'completed' | 'error';
  endpointKey?: string;
  cacheHit?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * SSE event types from the server.
 */
export type SSEEventType =
  | 'query:start'
  | 'query:complete'
  | 'query:error'
  | 'cache:hit'
  | 'cache:invalidate'
  | 'connected'
  | 'heartbeat';

/**
 * SSE event payload.
 */
export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data: T;
  timestamp: number;
  id?: string;
}

/**
 * Query event data from SSE.
 */
export interface QueryEventData {
  queryId: string;
  query?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
  rowCount?: number;
  error?: string;
  cacheHit?: boolean;
}
