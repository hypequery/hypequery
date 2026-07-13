import type { CanonicalValueLimits, CanonicalValueOptions } from './types.js';

type MutableCanonicalValueLimits = {
  -readonly [Key in keyof CanonicalValueLimits]: CanonicalValueLimits[Key];
};

export const DEFAULT_CANONICAL_VALUE_LIMITS: Readonly<CanonicalValueLimits> = Object.freeze({
  maxInputBytes: 1_048_576,
  maxCanonicalBytes: 1_048_576,
  maxDepth: 16,
  maxNodes: 10_000,
  maxCollectionItems: 1_000,
  maxStringBytes: 65_536,
  maxDecodedBytes: 65_536,
});

export function resolveLimits(
  options: CanonicalValueOptions = {},
): Readonly<CanonicalValueLimits> {
  const resolved: MutableCanonicalValueLimits = { ...DEFAULT_CANONICAL_VALUE_LIMITS };

  if (!options.limits) {
    return resolved;
  }

  for (const key of Object.keys(options.limits) as (keyof CanonicalValueLimits)[]) {
    const value = options.limits[key];
    if (
      value === undefined
      || !Number.isSafeInteger(value)
      || value < 1
      || value > DEFAULT_CANONICAL_VALUE_LIMITS[key]
    ) {
      throw new RangeError(
        `${key} must be a positive integer no greater than the protocol v1 maximum`,
      );
    }
    resolved[key] = value;
  }

  return Object.freeze(resolved);
}
