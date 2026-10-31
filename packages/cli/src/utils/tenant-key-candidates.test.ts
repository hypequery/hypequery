import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { isTenantKeyCandidateName, unscopedTenantCandidates } from './tenant-key-candidates.js';

const dimension = (name: string, column = name) => ({
  name, type: 'string', source: { kind: 'column', column }, filterable: true, groupable: true,
});
const served = { access: { kind: 'public' }, tenant: { kind: 'not-required' } };
const dataset = (name: string, fields: Record<string, unknown> = {}) => ({
  name,
  tenant: { kind: 'not-required' },
  dimensions: [],
  measures: [],
  filters: [],
  endpoint: served,
  ...fields,
});
const contract = {
  kind: 'hypequery-deployment',
  version: 2,
  datasets: [
    dataset('orders', { dimensions: [dimension('customer', 'Customer_ID'), dimension('status')] }),
    dataset('invoices', { tenant: { kind: 'required', field: 'tenant_id' }, dimensions: [dimension('tenant_id')] }),
    dataset('regions', { dimensions: [dimension('code')] }),
    dataset('seats', {
      measures: [{ name: 'workspaces', aggregation: 'countDistinct', field: 'seats.workspace_id' }],
      filters: [{ name: 'company', field: 'seats.company_id', operators: ['eq'] }],
    }),
    dataset('scoped_endpoint', {
      dimensions: [dimension('org_id')],
      endpoint: { ...served, tenant: { kind: 'required', mode: 'auto-inject', column: 'org_id' } },
    }),
    dataset('unserved', { dimensions: [dimension('account_id')], endpoint: undefined }),
    dataset('qualified', {
      dimensions: [
        dimension('buyer', 'qualified.customer_id'),
        {
          name: 'account',
          type: 'string',
          source: { kind: 'sql-expression', dialect: 'clickhouse', sql: 'lower(org_id)', output: {}, dependencies: ['org_id'] },
          filterable: true,
          groupable: true,
        },
      ],
    }),
    // A dimension named like a customer column over another physical column, and a
    // related table's customer column: neither is a column tenantKey could name.
    dataset('aliased', {
      dimensions: [dimension('tenant_id', 'organization_ref')],
      measures: [{ name: 'tenants', aggregation: 'countDistinct', field: 'tenant_id' }],
      filters: [{ name: 'account', field: 'customer.account_id', operators: ['eq'] }],
      relationships: [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_ref', to: 'id' }],
    }),
  ],
} as unknown as ProtocolDeploymentContract;

describe('tenant key candidates', () => {
  it('matches customer-like column names case-insensitively', () => {
    expect(['tenant_id', 'ORG_ID', 'account_id', 'organisation_id', 'workspace_id', 'company_id'].every(isTenantKeyCandidateName)).toBe(true);
    expect(isTenantKeyCandidateName('tenant')).toBe(false);
  });

  it('names served datasets with a customer column that nothing scopes, from any field', () => {
    expect(unscopedTenantCandidates(contract)).toEqual([
      { dataset: 'orders', columns: ['Customer_ID'] },
      { dataset: 'seats', columns: ['workspace_id', 'company_id'] },
      { dataset: 'qualified', columns: ['customer_id', 'org_id'] },
    ]);
  });
});
