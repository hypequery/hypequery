import type {
  ProtocolSemanticInvocationLimits,
  ProtocolSemanticInvocationOptions,
} from './types.js';

export const DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS:
Readonly<ProtocolSemanticInvocationLimits> = Object.freeze({
  maxTextBytes: 1_024,
  maxMessageBytes: 1_024,
  maxRows: 10_000,
  maxColumnsPerRow: 256,
  maxValueBytes: 65_536,
  maxDeadlineMs: 3_600_000,
  maxResponseBytes: 33_554_432,
});

export function resolveSemanticInvocationLimits(
  options: ProtocolSemanticInvocationOptions = {},
): Readonly<ProtocolSemanticInvocationLimits> {
  const result = { ...DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolSemanticInvocationLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_SEMANTIC_INVOCATION_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the semantic invocation v1 maximum)',
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
