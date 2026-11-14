import type {
  ProtocolBusinessContextLimits,
  ProtocolBusinessContextOptions,
} from './types.js';

/** Matches the limits Cloud onboarding already enforces on business profiles. */
export const DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS:
Readonly<ProtocolBusinessContextLimits> = Object.freeze({
  maxTextLength: 4_096,
  maxItems: 100,
  maxBytes: 1_024 * 1_024,
});

export function resolveBusinessContextLimits(
  options: ProtocolBusinessContextOptions = {},
): Readonly<ProtocolBusinessContextLimits> {
  const result = { ...DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolBusinessContextLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the business context v1 maximum)',
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
