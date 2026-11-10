import { dataset, dimension, measure } from '@hypequery/datasets';

const dimensions = {
  tenantId: dimension.number({ column: 'tenant_id' }),
  name: dimension.string(),
  plan: dimension.string({ label: 'Plan' }),
  region: dimension.string({ label: 'Region' }),
};
const measures = { tenants: measure.count('tenantId', { label: 'Tenants' }) };

/**
 * Tenants as they are now. `rowResolution` makes every query read the
 * ReplacingMergeTree with FINAL and drop keys whose latest row has
 * is_deleted = 1, so callers never see a superseded or deleted version,
 * whether or not ClickHouse has merged yet.
 */
export const Tenants = dataset('tenants', {
  source: 'replacingmergetree_upserts_tenants',
  rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' },
  dimensions,
  measures,
});

/** The same table without FINAL: one row per version that has not been merged away. */
export const TenantVersions = dataset('tenantVersions', {
  source: 'replacingmergetree_upserts_tenants',
  dimensions,
  measures: { rows: measure.count('tenantId', { label: 'Rows' }) },
});

/** The argMax alternative: a view that resolves the latest version per key with GROUP BY. */
export const TenantsLatest = dataset('tenantsLatest', {
  source: 'replacingmergetree_upserts_tenants_latest',
  dimensions,
  measures,
});
