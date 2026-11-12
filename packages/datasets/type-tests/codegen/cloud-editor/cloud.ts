// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { publishToCloud } from '../../../src/index.js';
import { datasets } from './datasets.js';

export const cloud = publishToCloud({
  datasets,
  access: { roles: [], scopes: [] },
  endpoints: {
    orders: {
      access: { kind: 'authenticated', roles: ['analyst'], scopes: [] },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      cacheTtlMs: 30000,
      maxLimit: 250,
      path: '/api/analytics/datasets/orders/query',
    },
  },
});
