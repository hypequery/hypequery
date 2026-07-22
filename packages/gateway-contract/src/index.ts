/** Current additive 0.x gateway contract version. */
export const GATEWAY_CONTRACT_VERSION = '0.1' as const;

export const KNOWN_GATEWAY_CAPABILITIES = [
  'registry',
  'execute',
  'history',
  'events',
  'cache',
  'cache:clear',
  'schema',
  'ai',
  'telemetry',
] as const;

export type KnownGatewayCapability = (typeof KNOWN_GATEWAY_CAPABILITIES)[number];

/**
 * Known capabilities retain autocomplete while the string intersection keeps
 * additive capabilities from breaking older Studio clients.
 */
export type GatewayCapability = KnownGatewayCapability | (string & {});

export type GatewayMode = 'local' | 'cloud';

export interface GatewayMeta {
  contractVersion: string;
  mode: GatewayMode;
  serverVersion?: string;
  capabilities: GatewayCapability[];
  project: { name: string };
  clickhouse?: { connected: boolean; database?: string; host?: string };
}

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

export interface RegistryResult {
  basePath?: string;
  endpoints: RegistryEntry[];
  total: number;
}

export interface ExecuteContext {
  tenantId?: string;
  roles?: string[];
}

export interface ExecuteRequest {
  key: string;
  input?: unknown;
  context?: ExecuteContext;
}

export interface GatewayError {
  type?: string;
  message: string;
  details?: unknown;
}

export interface ExecuteSuccess {
  success: true;
  queryId: string;
  key: string;
  result: unknown;
  durationMs: number;
  timestamp: number;
}

export interface ExecuteFailure {
  success: false;
  queryId?: string;
  error: GatewayError;
  durationMs?: number;
  timestamp: number;
}

export type ExecuteResult = ExecuteSuccess | ExecuteFailure;

export type QueryHistoryStatus = 'started' | 'completed' | 'error';
export type CacheStatus = 'hit' | 'miss' | 'stale-hit' | 'revalidate' | 'bypass';

export interface QueryTimingBreakdown {
  setupMs?: number;
  handlerMs?: number;
  serializeMs?: number;
}

export interface QueryHistoryEntry {
  id?: number;
  queryId: string;
  query: string;
  input?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: QueryHistoryStatus;
  error?: string;
  rowCount?: number | null;
  /** @deprecated Use cacheStatus instead. */
  cacheHit?: boolean;
  cacheStatus?: CacheStatus;
  cacheAgeMs?: number | null;
  cacheKey?: string;
  endpointKey?: string;
  endpointDescription?: string;
  endpointPath?: string;
  resultPreview?: unknown[];
  createdAt?: number;
  tenantId?: string;
  timing?: QueryTimingBreakdown;
}

export interface QueryFilters {
  status?: QueryHistoryStatus;
  endpointKey?: string;
  cacheHit?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface QueryListResult {
  queries: QueryHistoryEntry[];
  total: number;
}

export interface ClearHistoryResult {
  cleared: true;
  timestamp: number;
}

export interface ImportHistoryResult {
  imported: true;
  count: number;
  timestamp: number;
}

export interface LoggerStats {
  totalLogged: number;
  persisted: number;
  failed: number;
  queueSize: number;
  flushCount: number;
  avgBatchSize: number;
}

export type GatewayEventType =
  | 'query:started'
  | 'query:completed'
  | 'query:error'
  | 'cache:updated'
  | 'history:cleared'
  | 'connected'
  | 'shutdown'
  | 'heartbeat';

/** Event name and payload before SSE framing. */
export interface GatewayEvent<T = unknown> {
  type: GatewayEventType;
  data: T;
  id?: string;
}

/** @deprecated Use GatewayEventType. */
export type SSEEventType = GatewayEventType;

/** Studio's parsed event wrapper, timestamped when received. */
export interface SSEEvent<T = unknown> extends GatewayEvent<T> {
  timestamp: number;
}

export interface QueryStartedEventData {
  queryId: string;
  key?: string;
  startedAt: number;
}

export type QueryTerminalEventData = QueryHistoryEntry;
export type QueryEventData = QueryStartedEventData | QueryTerminalEventData;
