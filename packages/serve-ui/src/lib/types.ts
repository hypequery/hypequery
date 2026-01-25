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
  cacheHit?: boolean;
  cacheAgeMs?: number;
  endpointKey?: string;
  endpointPath?: string;
  resultPreview?: unknown[];
  createdAt?: number;
}

/**
 * Cache statistics snapshot.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  avgCacheAge: number;
  totalQueries: number;
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
