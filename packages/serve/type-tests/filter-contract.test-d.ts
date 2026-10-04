import { dataset, dimension, measure, belongsTo, hasOne, hasMany, eq, like } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '../src/index.js';

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
type Api = InferApiType<typeof api>;
const goodDataset: Api['dataset:orders']['input'] = { filters: [eq('state', 'paid'), eq('customer.country', 'US')] };
const goodMetric: Api['revenue']['input'] = { filters: [eq('profile.tier', 'enterprise')] };
void [goodDataset, goodMetric];
// @ts-expect-error InferApiType retains the local allowlist
const badDataset: Api['dataset:orders']['input'] = { filters: [eq('status', 'paid')] };
// @ts-expect-error InferApiType retains per-field operator restrictions
const badMetric: Api['revenue']['input'] = { filters: [like('state', '%paid%')] };
void [badDataset, badMetric];
api.run('dataset:orders', { input: goodDataset });
api.run('revenue', { input: goodMetric });
// @ts-expect-error API execution retains relationship filter policy
api.run('dataset:orders', { input: { filters: [eq('customer.hidden', 'x')] } });
// @ts-expect-error API execution retains metric filter policy
api.run('revenue', { input: { filters: [eq('amount', 1)] } });
