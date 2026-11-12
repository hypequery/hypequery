// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { publishToCloud } from '../../../src/index.js';
import { datasets, LegacyPlansDataset } from './datasets.js';

export const cloud = publishToCloud({
  datasets,
  access: { roles: ['analyst'], scopes: [] },
  datasetAccess: { daily_active_users: { roles: ['product'], scopes: ['events:read'] } },
  endpoints: {
    accounts: {
      access: { kind: 'authenticated', roles: ['support', 'analyst'], scopes: [] },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      maxLimit: 1000,
      path: '/api/analytics/datasets/accounts/query',
    },
    invoices: {
      access: { kind: 'authenticated', roles: [], scopes: [] },
      tenant: { kind: 'required', mode: 'manual', column: 'tenant_id' },
      cacheTtlMs: 60000,
      path: '/api/analytics/datasets/invoices/query',
    },
  },
  supporting: { legacy_plans: LegacyPlansDataset },
});
