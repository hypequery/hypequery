import type { ProtocolDeploymentContract } from '@hypequery/protocol';

// Kept in step with Cloud's customer-scope review, so the CLI and onboarding flag the same columns.
const CANDIDATE_NAMES = new Set([
  'tenant_id',
  'org_id',
  'organization_id',
  'organisation_id',
  'account_id',
  'customer_id',
  'workspace_id',
  'company_id',
]);

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

const columnOf = (field: string) => field.slice(field.lastIndexOf('.') + 1);

/**
 * Served datasets about to be published with a customer-like column that
 * neither the dataset nor its endpoint scopes by tenant. Datasets without an
 * endpoint are not callable, so they are skipped.
 */
export function unscopedTenantCandidates(contract: ProtocolDeploymentContract): UnscopedTenantCandidate[] {
  return contract.datasets.flatMap((dataset) => {
    if (!dataset.endpoint || dataset.tenant.kind === 'required' || dataset.endpoint.tenant.kind === 'required') return [];
    const columns = [...new Set([
      ...dataset.dimensions.map((dimension) => dimension.source.kind === 'column' ? dimension.source.column : dimension.name),
      ...dataset.measures.flatMap((measure) => 'field' in measure ? [columnOf(measure.field)] : []),
      ...dataset.filters.map((filter) => columnOf(filter.field)),
    ].filter(isTenantKeyCandidateName))];
    return columns.length ? [{ dataset: dataset.name, columns }] : [];
  });
}
