import { dataset, dimension, measure, belongsTo, hasOne, hasMany, eq, like } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { createAnalyticsHooks } from '../src/index.js';

const customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    country: dimension.string(), tier: dimension.string({ filterable: false }),
    computed: dimension.string({ sql: 'upper(country)' }), hidden: dimension.string(),
    alias: dimension.string(),
  },
  filters: {
    country: { __type: 'filter_definition', field: 'country', operators: ['eq', 'in'] },
    tier: { __type: 'filter_definition', field: 'tier', operators: ['eq'] },
    computed: { __type: 'filter_definition', field: 'computed' },
    alias: { __type: 'filter_definition', field: 'country' },
  },
});
const orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount') },
  filters: {
    state: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
    amount: { __type: 'filter_definition', field: 'amount', operators: ['gte'] },
  },
  relationships: {
    customer: belongsTo(() => customers, { from: 'customer_id', to: 'id' }),
    profile: hasOne(() => customers, { from: 'customer_id', to: 'id' }),
    items: hasMany(() => customers, { from: 'id', to: 'order_id' }),
  },
});
const revenue = orders.metric('revenue', { measure: 'revenue' });

const api = createAPI({ datasets: { orders }, metrics: { revenue }, queryBuilder: {} as never });
const hooks = createAnalyticsHooks<InferApiType<typeof api>>({ baseUrl: '/analytics' });
hooks.useDataset('orders', { filters: [eq('state', 'paid'), eq('customer.country', 'US')] });
hooks.useMetric('revenue', { filters: [eq('profile.tier', 'enterprise')] });
hooks.useInfiniteDataset('orders', { filters: [eq('state', 'paid')], limit: 10 });
hooks.useInfiniteMetric('revenue', { filters: [eq('customer.country', 'US')], limit: 10 });
hooks.useQuery('dataset:orders', { filters: [eq('state', 'paid')] });
// @ts-expect-error hook generic inference must not widen the allowlist
hooks.useDataset('orders', { filters: [eq('status', 'paid')] });
// @ts-expect-error metric hooks retain operator restrictions
hooks.useMetric('revenue', { filters: [like('state', '%paid%')] });
// @ts-expect-error infinite dataset hooks reject hidden relationship fields
hooks.useInfiniteDataset('orders', { filters: [eq('customer.hidden', 'x')] });
// @ts-expect-error infinite metric hooks reject hasMany traversal
hooks.useInfiniteMetric('revenue', { filters: [eq('items.country', 'US')] });
// @ts-expect-error ordinary query hooks retain semantic filter contracts
hooks.useQuery('dataset:orders', { filters: [eq('amount', 1)] });
