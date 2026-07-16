import type {
  ProtocolQueryImplementationLimits,
  ProtocolQueryImplementationOptions,
} from './types.js';

export const DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS: Readonly<ProtocolQueryImplementationLimits> = Object.freeze({
  maxStatementBytes: 1_048_576,
  maxExpressionBytes: 65_536,
  maxTypeBytes: 256,
  maxSourceBytes: 1_024,
  maxCollectionItems: 100,
});

export function resolveQueryImplementationLimits(
  options: ProtocolQueryImplementationOptions,
): Readonly<ProtocolQueryImplementationLimits> {
  const configured = options.limits ?? {};
  const result = { ...DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolQueryImplementationLimits)[]) {
    const value = configured[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1
      || value > DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS[key]) {
      throw new RangeError(`Invalid query implementation limit: ${key}`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
