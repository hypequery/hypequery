import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { isTenantKeyCandidateName, unscopedTenantCandidates } from './tenant-key-candidates.js';

const dimension = (name: string, column = name) => ({
  name, type: 'string', source: { kind: 'column', column }, filterable: true, groupable: true,
});
const contract = {
  kind: 'hypequery-deployment',
  version: 2,
  datasets: [
    { name: 'orders', tenant: { kind: 'not-required' }, dimensions: [dimension('customer', 'Customer_ID'), dimension('status')] },
    { name: 'invoices', tenant: { kind: 'required', field: 'tenant_id' }, dimensions: [dimension('tenant_id')] },
    { name: 'regions', tenant: { kind: 'not-required' }, dimensions: [dimension('code')] },
  ],
} as unknown as ProtocolDeploymentContract;

describe('tenant key candidates', () => {
  it('matches customer-like column names case-insensitively', () => {
    expect(['tenant_id', 'ORG_ID', 'account_id'].every(isTenantKeyCandidateName)).toBe(true);
    expect(isTenantKeyCandidateName('tenant')).toBe(false);
  });

  it('names published datasets with a customer column and no tenant key, by column', () => {
    expect(unscopedTenantCandidates(contract)).toEqual([{ dataset: 'orders', columns: ['Customer_ID'] }]);
  });
});
