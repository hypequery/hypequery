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

type Dataset = ProtocolDeploymentContract['datasets'][number];

const lastSegment = (name: string) => name.slice(name.lastIndexOf('.') + 1);

/**
 * The physical columns a dataset reads from its own table, which are the only
 * values `tenantKey` accepts. Dimension sources may be table-qualified or SQL
 * with declared dependencies; measure and filter fields may name a dimension,
 * which resolves to its source. Fields reached through a relationship belong
 * to another table and are skipped.
 */
function ownColumns(dataset: Dataset): string[] {
  const related = new Set((dataset.relationships ?? []).map((relationship) => String(relationship.name)));
  const own = (reference: string) => {
    const dot = reference.lastIndexOf('.');
    return dot < 0 || !related.has(reference.slice(0, dot));
  };
  const sourceColumns = (dimension: Dataset['dimensions'][number]): string[] =>
    (dimension.source.kind === 'column' ? [dimension.source.column] : dimension.source.dependencies.map(String))
      .filter(own)
      .map(lastSegment);
  const dimensions = new Map(dataset.dimensions.map((dimension) => [String(dimension.name), dimension]));
  const resolve = (field: string): string[] => {
    if (!own(field)) return [];
    const dimension = dimensions.get(lastSegment(field));
    return dimension ? sourceColumns(dimension) : [lastSegment(field)];
  };
  return [
    ...dataset.dimensions.flatMap(sourceColumns),
    ...dataset.measures.flatMap((measure) => 'field' in measure ? resolve(String(measure.field)) : []),
    ...dataset.filters.flatMap((filter) => resolve(String(filter.field))),
  ];
}

/**
 * Served datasets about to be published with a customer-like column that
 * neither the dataset nor its endpoint scopes by tenant. Datasets without an
 * endpoint are not callable, so they are skipped.
 */
export function unscopedTenantCandidates(contract: ProtocolDeploymentContract): UnscopedTenantCandidate[] {
  return contract.datasets.flatMap((dataset) => {
    if (!dataset.endpoint || dataset.tenant.kind === 'required' || dataset.endpoint.tenant.kind === 'required') return [];
    const columns = [...new Set(ownColumns(dataset).filter(isTenantKeyCandidateName))];
    return columns.length ? [{ dataset: dataset.name, columns }] : [];
  });
}
