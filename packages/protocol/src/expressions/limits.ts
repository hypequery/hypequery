import type { ProtocolExpressionLimits, ProtocolExpressionOptions } from './types.js';

export const DEFAULT_PROTOCOL_EXPRESSION_LIMITS: Readonly<ProtocolExpressionLimits> = Object.freeze({
  maxDepth: 16,
  maxNodes: 1_000,
  maxCollectionItems: 100,
});

export function resolveExpressionLimits(
  options: ProtocolExpressionOptions = {},
): Readonly<ProtocolExpressionLimits> {
  const limits = { ...DEFAULT_PROTOCOL_EXPRESSION_LIMITS };
  for (const key of Object.keys(options.limits ?? {}) as (keyof ProtocolExpressionLimits)[]) {
    const value = options.limits?.[key];
    if (!Number.isSafeInteger(value) || (value as number) < 1
      || (value as number) > DEFAULT_PROTOCOL_EXPRESSION_LIMITS[key]) {
      throw new RangeError(`${key} must be a positive integer no greater than the protocol v1 maximum`);
    }
    limits[key] = value as number;
  }
  return Object.freeze(limits);
}
