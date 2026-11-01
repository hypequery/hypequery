import type { ClientQueryLimits, ProtocolDeploymentDataset } from '@hypequery/protocol';

/**
 * Trusted host ceilings for an exported client contract. The host must enforce
 * at least these bounds; the export only ever narrows them by each dataset's
 * own limits and endpoint `maxLimit`. Defaults mirror Python's ClientQueryProfile.
 */
export interface ClientContractProfile {
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
  readonly maxOffset?: number;
  readonly maxDimensions?: number;
  readonly maxMeasures?: number;
  readonly maxPredicates?: number;
  readonly maxOrderBy?: number;
  readonly maxFilterValues?: number;
  /** IANA zone used when a request names none. */
  readonly defaultTimezone?: string;
}

const DEFAULT_PROFILE: Required<ClientContractProfile> = {
  defaultLimit: 1000,
  maxLimit: 1000,
  maxOffset: 1_000_000,
  maxDimensions: 100,
  maxMeasures: 100,
  maxPredicates: 100,
  maxOrderBy: 100,
  maxFilterValues: 10_000,
  defaultTimezone: 'UTC',
};

export function resolveClientContractProfile(profile: ClientContractProfile = {}): Required<ClientContractProfile> {
  return { ...DEFAULT_PROFILE, ...Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)) };
}

const narrower = (ceiling: number, value: number | undefined) => value === undefined ? ceiling : Math.min(ceiling, value);

/** Intersect the profile with the dataset's own ceilings; never widen them. */
export function clientQueryLimits(dataset: ProtocolDeploymentDataset, profile: Required<ClientContractProfile>): ClientQueryLimits {
  const maxLimit = narrower(narrower(profile.maxLimit, dataset.limits?.maxResultSize), dataset.endpoint?.maxLimit);
  return {
    defaultLimit: Math.min(profile.defaultLimit, maxLimit),
    maxLimit,
    maxOffset: profile.maxOffset,
    maxDimensions: narrower(profile.maxDimensions, dataset.limits?.maxDimensions),
    maxMeasures: narrower(profile.maxMeasures, dataset.limits?.maxMeasures),
    maxPredicates: narrower(profile.maxPredicates, dataset.limits?.maxFilters),
    maxOrderBy: profile.maxOrderBy,
    maxFilterValues: profile.maxFilterValues,
  };
}
