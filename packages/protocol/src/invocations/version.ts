/**
 * Semantic invocation version selection (RFC 0015, RFC 0030).
 *
 * Query features are gated by invocation version only. Under the
 * lowest-version rule an operation is invocation 2 exactly when it uses an
 * expression extension 2 feature, and invocation 1 otherwise.
 */

import { isProtocolEventOperationKind } from '../event-operations/index.js';
import type { ProtocolSemanticInvocationOperation } from './types.js';

/** What forces an operation to semantic invocation 2, in a fixed order. */
export type ProtocolSemanticInvocation2Feature =
  | 'segments'
  | 'subDayGrain'
  | 'relationshipMeasures'
  | 'calculations'
  | 'limitBy'
  | 'other';

/**
 * The invocation 2 features `operation` uses, in a fixed order. Empty for an
 * invocation 1 operation, including every RFC 0027 event operation.
 */
export function semanticInvocation2Features(
  operation: ProtocolSemanticInvocationOperation,
): readonly ProtocolSemanticInvocation2Feature[] {
  if (isProtocolEventOperationKind(operation.kind)) return Object.freeze([]);
  const query = operation as {
    readonly kind: string;
    readonly segments?: readonly unknown[];
    readonly by?: string;
    readonly measures?: readonly string[];
    readonly calculations?: readonly unknown[];
    readonly limitBy?: unknown;
    readonly other?: unknown;
  };
  const dataset = query.kind === 'dataset';
  const used: Record<ProtocolSemanticInvocation2Feature, boolean> = {
    segments: (query.segments?.length ?? 0) > 0,
    subDayGrain: query.by === 'minute' || query.by === 'hour',
    relationshipMeasures: dataset && (query.measures ?? []).some(measure => String(measure).includes('.')),
    // RFC 0026: query-scoped calculations are extension 2 dataset queries only.
    calculations: dataset && (query.calculations?.length ?? 0) > 0,
    limitBy: dataset && query.limitBy !== undefined,
    other: dataset && query.other !== undefined,
  };
  return Object.freeze((Object.keys(used) as ProtocolSemanticInvocation2Feature[]).filter(feature => used[feature]));
}

/**
 * The semantic invocation version `operation` must be sent as: 2 when it uses
 * an expression extension 2 feature, 1 otherwise. A caller checks the result
 * against the target's `accepts.semanticInvocation` and refuses, naming
 * `semanticInvocation2Features`, rather than dropping features to fit.
 */
export function semanticInvocationVersion(operation: ProtocolSemanticInvocationOperation): 1 | 2 {
  return semanticInvocation2Features(operation).length > 0 ? 2 : 1;
}
