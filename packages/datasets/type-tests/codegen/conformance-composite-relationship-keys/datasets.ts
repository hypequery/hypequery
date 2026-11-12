// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { belongsTo, dataset } from '../../../src/index.js';

export const CustomersDataset = dataset('customers', { source: 'customers', dimensions: {} });

export const OrdersDataset = dataset('orders', {
  source: 'orders',
  dimensions: {},
  relationships: {
    customer: belongsTo(() => CustomersDataset, { keys: [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }] }),
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  customers: CustomersDataset,
  orders: OrdersDataset,
};
