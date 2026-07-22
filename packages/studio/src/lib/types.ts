/**
 * Studio consumes the public gateway wire contract from one package. Keep
 * this compatibility module so existing internal and external source imports
 * do not need to know where the contract is defined.
 */
export type {
  CacheStatus,
  ClearHistoryResult,
  ExecuteFailure,
  ExecuteRequest,
  ExecuteResult,
  ExecuteSuccess,
  GatewayCapability,
  GatewayError,
  GatewayEvent,
  GatewayEventType,
  GatewayMeta,
  GatewayMode,
  ImportHistoryResult,
  KnownGatewayCapability,
  LoggerStats,
  QueryEventData,
  QueryFilters,
  QueryHistoryEntry,
  QueryHistoryStatus,
  QueryListResult,
  QueryStartedEventData,
  QueryTerminalEventData,
  QueryTimingBreakdown,
  RegistryEntry,
  RegistryResult,
  SSEEvent,
  SSEEventType,
} from '@hypequery/gateway-contract';
