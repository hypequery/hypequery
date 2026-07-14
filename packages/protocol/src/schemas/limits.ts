import type { ProtocolSchemaLimits, ProtocolSchemaOptions } from './types.js';

export const DEFAULT_PROTOCOL_SCHEMA_LIMITS: Readonly<ProtocolSchemaLimits> = Object.freeze({
  maxDepth: 16,
  maxNodes: 1_000,
  maxCollectionItems: 100,
  maxDescriptionBytes: 4_096,
});

export function resolveSchemaLimits(
  options: ProtocolSchemaOptions = {},
): Readonly<ProtocolSchemaLimits> {
  const limits = { ...DEFAULT_PROTOCOL_SCHEMA_LIMITS };
  for (const key of Object.keys(options.limits ?? {}) as (keyof ProtocolSchemaLimits)[]) {
    const value = options.limits?.[key];
    if (!Number.isSafeInteger(value) || (value as number) < 1
      || (value as number) > DEFAULT_PROTOCOL_SCHEMA_LIMITS[key]) {
      throw new RangeError(`${key} must be a positive integer no greater than the protocol v1 maximum`);
    }
    limits[key] = value as number;
  }
  return Object.freeze(limits);
}
