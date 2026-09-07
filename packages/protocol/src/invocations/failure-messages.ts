import type { ProtocolSemanticInvocationFailureCategory } from './types.js';

/** Fixed public messages; provider exceptions belong only in private logs. */
export const PROTOCOL_SEMANTIC_FAILURE_MESSAGES: Readonly<Record<ProtocolSemanticInvocationFailureCategory, string>> = Object.freeze({
  "configuration-invalid": "The execution configuration is invalid.",
  "not-found": "The requested target was not found.",
  "unauthenticated": "Authentication is required.",
  "forbidden": "Access is forbidden.",
  "tenant-required": "A trusted tenant is required.",
  "input-invalid": "The semantic query is invalid.",
  "budget-exceeded": "The invocation budget was exceeded.",
  "cancelled": "The invocation was cancelled.",
  "stale-activation": "The pinned activation is no longer active.",
  "unsupported-capability": "Portable execution cannot reproduce this target.",
  "executor-unavailable": "The executor is unavailable.",
  "executor-failed": "The executor failed.",
  "output-invalid": "The executor returned an invalid result."
});
