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
  input?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'running' | 'started' | 'completed' | 'error';
  error?: string;
  rowCount?: number | null;
  /** @deprecated Use cacheStatus instead */
  cacheHit?: boolean;
  /** Cache status: hit, miss, stale, or bypass */
  cacheStatus?: CacheStatus;
  cacheAgeMs?: number | null;
  cacheKey?: string;
  endpointKey?: string;
  endpointDescription?: string;
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
  status?: 'pending' | 'running' | 'started' | 'completed' | 'error';
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
  | 'query:started'
  | 'query:completed'
  | 'query:error'
  | 'cache:updated'
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
 * Capability strings advertised by the gateway via /meta. The UI must
 * tolerate unknown strings (contract is additive within 0.x), so treat this
 * union as the known set, not an exhaustive one.
 */
export type GatewayCapability =
  | 'registry'
  | 'execute'
  | 'history'
  | 'events'
  | 'cache'
  | 'cache:clear'
  | 'schema'
  | 'ai'
  | 'telemetry';

/** Response of GET /meta. */
export interface GatewayMeta {
  contractVersion: string;
  mode: 'local' | 'cloud';
  capabilities: GatewayCapability[];
  project: { name: string };
  clickhouse?: { connected: boolean; database?: string; host?: string };
}

/** One endpoint in the registry. */
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

/** Response of GET /registry. */
export interface RegistryResult {
  basePath?: string;
  endpoints: RegistryEntry[];
  total: number;
}

/** Response of POST /execute. */
export interface ExecuteResult {
  success: boolean;
  queryId?: string;
  key?: string;
  result?: unknown;
  durationMs: number;
  timestamp: number;
  error?: { type?: string; message: string; details?: unknown };
}

/**
 * Query event data from SSE.
 */
export interface QueryEventData {
  queryId: string;
  query?: string;
  input?: unknown;
  status: 'pending' | 'running' | 'started' | 'completed' | 'error';
  duration?: number;
  rowCount?: number;
  error?: string;
  cacheHit?: boolean;
  endpointKey?: string;
  endpointDescription?: string;
  endpointPath?: string;
}
