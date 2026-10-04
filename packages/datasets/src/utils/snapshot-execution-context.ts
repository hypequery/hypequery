import type { ExecutionContext } from '../types.js';

/** Bind cache identity and deferred execution to the same request-owned scope. */
export function snapshotExecutionContext(context?: ExecutionContext): ExecutionContext | undefined {
  if (context === undefined) return undefined;
  return {
    ...context,
    ...(context.runtime === undefined ? {} : {
      runtime: {
        ...context.runtime,
        // Copy tenant objects and ID lists; retain adapter and AbortSignal identity.
        tenant: structuredClone(context.runtime.tenant),
      },
    }),
    ...(context.cache && { cache: { ...context.cache } }),
  };
}
