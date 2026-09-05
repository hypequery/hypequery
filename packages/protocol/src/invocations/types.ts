import type { ProtocolSemanticQuery } from '../expressions/index.js';

export interface ProtocolSemanticInvocationTarget {
  readonly project: string;
  readonly environment: string;
}

/**
 * Caller-requested ceilings. A runtime applies the most restrictive of these,
 * the endpoint policy, and its own defaults — a caller can tighten a budget but
 * never widen one.
 */
export interface ProtocolSemanticInvocationBudget {
  readonly deadlineMs?: number;
  readonly maxRows?: number;
  readonly maxResponseBytes?: number;
}

/**
 * One dataset or metric invocation against an activated deployment.
 *
 * Decision 0002 sketched the dataset/metric name beside the nested query, which
 * would let the two disagree. It also permits normalizing to a single
 * identifier location, so the names live only inside `operation`, whose own
 * `kind` discriminates dataset from metric.
 *
 * There is deliberately no tenant field: a caller cannot supply or change a
 * tenant, which is resolved by the provider callback inside trusted execution
 * context.
 */
export interface ProtocolSemanticInvocation {
  readonly kind: 'hypequery-semantic-invocation';
  readonly version: 1;
  readonly target: ProtocolSemanticInvocationTarget;
  /** Pins execution to one activation. Omit to accept whichever is active. */
  readonly activationRevision?: string;
  readonly operation: ProtocolSemanticQuery;
  readonly budget?: ProtocolSemanticInvocationBudget;
  /** External correlation only; never authoritative. */
  readonly correlationId?: string;
}

/**
 * A result cell. Portable execution returns scalars; anything richer would need
 * the RFC 0001 tagged value model, which this envelope deliberately does not
 * pull into result rows.
 */
export type ProtocolSemanticInvocationValue = string | number | boolean | null;

export type ProtocolSemanticInvocationRow = Readonly<
  Record<string, ProtocolSemanticInvocationValue>
>;

export interface ProtocolSemanticInvocationPagination {
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface ProtocolSemanticInvocationMeta {
  readonly rowCount: number;
  readonly pagination?: ProtocolSemanticInvocationPagination;
}

/**
 * The successful result. Operational metadata (trace, timing, cache outcome)
 * belongs in the transport's own metadata rather than beside the rows shown to
 * a model, so it is not carried here.
 */
export interface ProtocolSemanticInvocationResult {
  readonly kind: 'hypequery-semantic-invocation-result';
  readonly version: 1;
  /** The activation that actually served the call, never the one requested. */
  readonly activationRevision: string;
  readonly data: readonly ProtocolSemanticInvocationRow[];
  readonly meta: ProtocolSemanticInvocationMeta;
}

/** Provider-neutral failure categories from decision 0002, plus decision 0005. */
export type ProtocolSemanticInvocationFailureCategory =
  | 'configuration-invalid'
  | 'not-found'
  | 'unauthenticated'
  | 'forbidden'
  | 'tenant-required'
  | 'input-invalid'
  | 'budget-exceeded'
  | 'cancelled'
  | 'stale-activation'
  /** Portable execution cannot reproduce this target exactly. Decision 0005. */
  | 'unsupported-capability'
  | 'executor-unavailable'
  | 'executor-failed'
  | 'output-invalid';

/**
 * A failed invocation. Closed by construction: there is no field that accepts
 * SQL, parameter values, tenant identifiers, physical source details, stack
 * traces, or a provider exception.
 */
export interface ProtocolSemanticInvocationFailure {
  readonly kind: 'hypequery-semantic-invocation-failure';
  readonly version: 1;
  readonly category: ProtocolSemanticInvocationFailureCategory;
  /** Stable machine-readable code, e.g. `HQ_SEMANTIC_TENANT_REQUIRED`. */
  readonly code: string;
  readonly message: string;
  /** Bounded input path for a correctable failure, e.g. `$.operation.limit`. */
  readonly path?: string;
  readonly retryable: boolean;
  /** The caller must re-read discovery before retrying. */
  readonly relist: boolean;
  readonly activationRevision?: string;
}

export interface ProtocolSemanticInvocationLimits {
  readonly maxTextBytes: number;
  readonly maxMessageBytes: number;
  readonly maxRows: number;
  readonly maxColumnsPerRow: number;
  readonly maxValueBytes: number;
  readonly maxDeadlineMs: number;
  readonly maxResponseBytes: number;
}

/**
 * Validation budgets for a semantic invocation.
 *
 * Each configured value must be a positive safe integer no greater than the
 * corresponding value in `DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS`. These
 * options may tighten the v1 conformance limits but cannot raise them.
 */
export interface ProtocolSemanticInvocationOptions {
  readonly limits?: Partial<ProtocolSemanticInvocationLimits>;
}

export type ProtocolSemanticInvocationErrorCode =
  | 'HQ_INVOCATION_TYPE'
  | 'HQ_INVOCATION_UNKNOWN_FIELD'
  | 'HQ_INVOCATION_INVALID_VERSION'
  | 'HQ_INVOCATION_INVALID_VALUE'
  | 'HQ_INVOCATION_TOO_MANY_ITEMS'
  | 'HQ_INVOCATION_TOO_LARGE'
  | 'HQ_INVOCATION_UNSAFE_OBJECT';
