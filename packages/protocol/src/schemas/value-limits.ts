import type { ProtocolSchemaValueLimits, ProtocolSchemaValueOptions } from './types.js';

export const DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS: Readonly<ProtocolSchemaValueLimits> =
  Object.freeze({
    maxInputBytes: 1_048_576,
    maxDepth: 32,
    maxNodes: 10_000,
    maxCollectionItems: 1_000,
    maxStringBytes: 1_048_576,
  });

export function resolveProtocolSchemaValueLimits(
  options: ProtocolSchemaValueOptions = {},
): Readonly<ProtocolSchemaValueLimits> {
  const limits = { ...DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS };
  for (const key of Object.keys(options.limits ?? {}) as (keyof ProtocolSchemaValueLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1
      || value > DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS[key]) {
      throw new RangeError(
        `${key} must be a positive integer no greater than the protocol schema-value v1 maximum`,
      );
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}
