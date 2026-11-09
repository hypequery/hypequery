import {
  buildDatasetClientContract,
  dataset,
  dimension,
  measure,
  type BuildDatasetClientContractOptions,
  type DatasetClientEndpoint,
} from '../src/index.js';
import type { PreparedProtocolClientContract } from '@hypequery/protocol';

const orders = dataset('orders', {
  source: 'orders',
  dimensions: { country: dimension.string(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount') },
});
const revenue = orders.metric('revenue', { measure: 'revenue' });

const endpoints: readonly DatasetClientEndpoint[] = [
  { dataset: orders, path: '/datasets/orders/query', profile: { maxLimit: 500, defaultTimezone: 'UTC' } },
  { dataset: orders, path: '/metrics/revenue', metric: revenue, name: 'revenue' },
];
const options: BuildDatasetClientContractOptions = { mountPath: '/v1', view: 'build' };
const prepared: PreparedProtocolClientContract = buildDatasetClientContract(endpoints, options);
buildDatasetClientContract(endpoints);
void prepared.contract.endpoints;

// @ts-expect-error An endpoint names the dataset it serves.
const noDataset: DatasetClientEndpoint = { path: '/datasets/orders/query' };
// @ts-expect-error Profiles hold numeric ceilings.
const badProfile: DatasetClientEndpoint = { dataset: orders, path: '/x', profile: { maxLimit: '500' } };
// @ts-expect-error The view is build or authorized.
const badView: BuildDatasetClientContractOptions = { view: 'public' };
// @ts-expect-error Endpoint fields are read-only.
endpoints[0].path = '/elsewhere';
// @ts-expect-error The export returns a prepared contract, not a raw one.
const raw: { kind: 'hypequery-client-contract' } = buildDatasetClientContract(endpoints);
void [noDataset, badProfile, badView, raw];
