import type { AnyDatasetInstance, ClientContractProfile } from '@hypequery/datasets';

/** RFC 0018's ceiling on one page; a larger endpoint cap is advertised as this. */
const CLIENT_MAX_LIMIT = 100_000;

/** The page cap a semantic endpoint clamps to: the entry's, else the dataset's, else 1000. */
export function endpointMaxLimit(dataset: AnyDatasetInstance, maxLimit: number | undefined): number {
  return maxLimit ?? dataset.limits?.maxResultSize ?? 1000;
}

/**
 * The client profile a semantic endpoint enforces on a pinned request. An
 * omitted `limit` reads the endpoint's whole page cap, so that is both its
 * default and its maximum; other ceilings keep the profile defaults.
 */
export function endpointClientProfile(dataset: AnyDatasetInstance, maxLimit: number | undefined): ClientContractProfile {
  const cap = Math.min(endpointMaxLimit(dataset, maxLimit), CLIENT_MAX_LIMIT);
  return { maxLimit: cap, defaultLimit: cap };
}
