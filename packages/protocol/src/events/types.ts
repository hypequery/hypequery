export interface ProtocolQueryEventTarget {
  readonly project: string;
  readonly environment: string;
}

export type ProtocolQueryOperation = 'query' | 'command' | 'insert';

export type ProtocolQueryEventOutcome = 'success' | 'failure';

/** RFC 0010 version 1 minimum public error categories. */
export type ProtocolQueryErrorCategory =
  | 'input-invalid'
  | 'unauthenticated'
  | 'forbidden'
  | 'tenant-required'
  | 'not-found'
  | 'too-large'
  | 'aborted'
  | 'deadline-exceeded'
  | 'unavailable'
  | 'internal';

/** Metadata-only record of one execution. Never carries values, SQL, or credentials. */
export interface ProtocolQueryEvent {
  readonly kind: 'hypequery-query-event';
  readonly version: 1;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly target: ProtocolQueryEventTarget;
  readonly queryName: string;
  readonly operation: ProtocolQueryOperation;
  readonly outcome: ProtocolQueryEventOutcome;
  /** Required when outcome is 'failure'; forbidden when outcome is 'success'. */
  readonly errorCategory?: ProtocolQueryErrorCategory;
  readonly durationMs: number;
  readonly rowCount?: number;
  /** Derived server-side fingerprint; the raw tenant identifier is prohibited. */
  readonly tenantFingerprint?: string;
  /** External correlation only; never authoritative. */
  readonly correlationId?: string;
}

export type ProtocolQueryTerminalReason =
  | 'completed'
  | 'aborted'
  | 'deadline-exceeded'
  | 'drained';

/** Privileged diagnostics projection; requires the RFC 0009 diagnostic capability. */
export interface ProtocolQueryDiagnostics {
  readonly kind: 'hypequery-query-diagnostics';
  readonly version: 1;
  readonly eventId: string;
  readonly queryId: string;
  readonly terminalReason: ProtocolQueryTerminalReason;
  readonly attempts: number;
  readonly runtimeIdentity?: string;
  /** Non-executable RFC 0010 debug form; contains no values. */
  readonly debugQuery?: string;
  readonly safeMessage?: string;
}

export interface ProtocolQueryEventLimits {
  readonly maxStringBytes: number;
  readonly maxDebugBytes: number;
}

/** Parser budgets that may tighten, but not raise, query-event v1 limits. */
export interface ProtocolQueryEventOptions {
  readonly limits?: Partial<ProtocolQueryEventLimits>;
}

export type ProtocolQueryEventErrorCode =
  | 'HQ_EVENT_TYPE'
  | 'HQ_EVENT_UNKNOWN_FIELD'
  | 'HQ_EVENT_INVALID_VERSION'
  | 'HQ_EVENT_INVALID_VALUE'
  | 'HQ_EVENT_TOO_LARGE'
  | 'HQ_EVENT_UNSAFE_OBJECT';

export type ProtocolQueryDiagnosticsErrorCode =
  | 'HQ_DIAGNOSTICS_TYPE'
  | 'HQ_DIAGNOSTICS_UNKNOWN_FIELD'
  | 'HQ_DIAGNOSTICS_INVALID_VERSION'
  | 'HQ_DIAGNOSTICS_INVALID_VALUE'
  | 'HQ_DIAGNOSTICS_TOO_LARGE'
  | 'HQ_DIAGNOSTICS_UNSAFE_OBJECT';
