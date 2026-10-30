import type { ProtocolDeploymentContract } from '@hypequery/protocol';

const CANDIDATE_NAMES = new Set(['tenant_id', 'organization_id', 'org_id', 'account_id', 'customer_id']);

/**
 * Whether a column name is worth presenting as a possible tenant key.
 *
 * A naming match is never enough to activate tenant enforcement. `tenantKey`
 * is a security boundary that must be chosen explicitly by the application.
 */
export function isTenantKeyCandidateName(name: string): boolean {
  return CANDIDATE_NAMES.has(name.toLowerCase());
}

export interface UnscopedTenantCandidate {
  readonly dataset: string;
  readonly columns: readonly string[];
}

/** Datasets about to be published with a customer-like column but no tenant key. */
export function unscopedTenantCandidates(contract: ProtocolDeploymentContract): UnscopedTenantCandidate[] {
  return contract.datasets.flatMap((dataset) => {
    if (dataset.tenant.kind === 'required') return [];
    const columns = [...new Set(dataset.dimensions
      .map((dimension) => dimension.source.kind === 'column' ? dimension.source.column : dimension.name)
      .filter(isTenantKeyCandidateName))];
    return columns.length ? [{ dataset: dataset.name, columns }] : [];
  });
}
