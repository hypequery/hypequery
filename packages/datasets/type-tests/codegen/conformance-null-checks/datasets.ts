// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, measure } from '../../../src/index.js';

export const CustomersDataset = dataset('customers', {
  source: 'customers',
  dimensions: {
    churnedAt: dimension.timestamp({ column: 'churned_at' }),
    plan: dimension.string(),
    trial: dimension.boolean(),
  },
  measures: {
    activeCustomers: measure.count('id', {
      filters: [
        { field: 'churned_at', operator: 'isNull' },
        { field: 'trial', operator: 'eq', value: false },
      ],
    }),
    churnedCustomers: measure.count('id', { filters: [{ field: 'churned_at', operator: 'isNotNull' }] }),
  },
  filters: {
    churnedAt: { __type: 'filter_definition', field: 'churnedAt', operators: ['gte', 'isNotNull', 'isNull'] },
    trial: { __type: 'filter_definition', field: 'trial', operators: ['eq', 'isNull'] },
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  customers: CustomersDataset,
};
