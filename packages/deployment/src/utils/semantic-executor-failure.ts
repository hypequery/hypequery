import type { ProtocolSemanticInvocationFailureCategory } from '@hypequery/protocol';

/**
 * Categories an injected executor may claim for itself.
 *
 * Execution is injected, so the executor is the only component that knows the
 * difference between "this query broke", "this deployment cannot express that",
 * and "this deployment is incoherent". Every category here is one only the
 * executor can determine; the ones it must never claim — `unauthenticated`,
 * `forbidden`, `cancelled`, `stale-activation` — are decided by this module and
 * are deliberately absent.
 */
const EXECUTOR_CATEGORIES: ReadonlySet<string> = new Set([
  'unsupported-capability',
  'budget-exceeded',
  'tenant-required',
  'configuration-invalid',
  'not-found',
  'input-invalid',
  'output-invalid',
  'executor-unavailable',
  'executor-failed',
]);

interface ExecutorFailureShape {
  readonly hypequerySemanticFailure?: unknown;
  readonly category?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly retryable?: unknown;
  readonly relist?: unknown;
}

/**
 * The category an executor claimed, when it deliberately claimed one.
 *
 * The `hypequerySemanticFailure` marker, not the shape of the error, is what
 * grants the claim. Allow-listing a `category` string alone would let a
 * provider or library exception that happens to carry a generic one — a
 * `not-found` from an HTTP client, say — put its own message in front of a
 * caller and decide whether the call is retried. This module refuses to unwrap
 * a cause for exactly that reason, and duck-typing would have reopened the door
 * beside it. An error without the marker stays `executor-failed` with the
 * generic message.
 */
export function claimedFailure(error: unknown): {
  category: ProtocolSemanticInvocationFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  relist: boolean;
} | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const shape = error as ExecutorFailureShape;
  if (shape.hypequerySemanticFailure !== true) return undefined;
  if (typeof shape.category !== 'string' || !EXECUTOR_CATEGORIES.has(shape.category)) {
    return undefined;
  }
  return {
    category: shape.category as ProtocolSemanticInvocationFailureCategory,
    code: typeof shape.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(shape.code)
      ? shape.code
      : 'HQ_SEMANTIC_EXECUTION_FAILED',
    message: typeof shape.message === 'string' ? shape.message : 'Semantic execution failed.',
    retryable: shape.retryable === true,
    relist: shape.relist === true,
  };
}

