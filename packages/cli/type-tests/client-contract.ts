import { clientManifest, clientContractHash, type ClientApi } from './client-contract.generated.js';

type Orders = ClientApi['dataset:orders']['input'];
type Revenue = ClientApi['ordersRevenue']['input'];
const valid: Orders = {
  dimensions: ['country', 'amount', 'customer.tier'], measures: ['revenue'], by: 'day',
  filters: [{ field: 'amount', operator: 'between', value: [1, 5] }, { field: 'customer.active', operator: 'eq', value: true }],
  having: [{ measure: 'revenue', operator: 'gt', value: 0 }],
};
// @ts-expect-error Unknown dimensions are not advertised.
const badDimension: Orders = { dimensions: ['PRIVATE_COLUMN'] };
// @ts-expect-error Non-groupable fields cannot be selected.
const notGroupable: Orders = { dimensions: ['customer.active'] };
// @ts-expect-error Numeric predicates need numeric values.
const badValue: Orders = { filters: [{ field: 'amount', operator: 'eq', value: '1' }] };
// @ts-expect-error String-only operator is not allowed on a numeric field.
const badOperator: Orders = { filters: [{ field: 'amount', operator: 'like', value: 1 }] };
// @ts-expect-error BETWEEN needs exactly two values.
const badBetween: Orders = { filters: [{ field: 'amount', operator: 'between', value: [1] }] };
// @ts-expect-error IN cannot be empty.
const badIn: Orders = { filters: [{ field: 'country', operator: 'in', value: [] }] };
// @ts-expect-error HAVING excludes nonnumeric aggregate aliases.
const badHaving: Orders = { having: [{ measure: 'latestLabel', operator: 'eq', value: 1 }] };
// @ts-expect-error Metric requests cannot override measures.
const metricOverride: Revenue = { measures: ['revenue'] };
// @ts-expect-error Country-only endpoint has no time controls.
const noTime: ClientApi['dataset:countries']['input'] = { by: 'day' };
// @ts-expect-error Country-only endpoint does not allow metadata.
const noMetadata: ClientApi['dataset:countries']['input'] = { includeMeta: true };
const method: 'POST' = clientManifest.ordersRevenue.method;
const path: '/api/v1/datasets/orders/query' = clientManifest['dataset:orders'].path;
const hash: string = clientContractHash;
type Row = ClientApi['dataset:orders']['output']['data'][number];
const wire: Row = { amount: '9007199254740993', 'customer.tier': null, revenue: null, period: null };
// @ts-expect-error Known nonnullable dimension excludes null.
const nullCountry: Row = { country: null };
// @ts-expect-error Aggregates are strings or null on the wire.
const numericMeasure: Row = { revenue: 1 };
const metricRow: ClientApi['ordersRevenue']['output']['data'][number] = { revenue: '12' };
// @ts-expect-error Metric output alias differs from its endpoint identifier.
const badMetricAlias: ClientApi['ordersRevenue']['output']['data'][number] = { ordersRevenue: '12' };
void [valid, badDimension, notGroupable, badValue, badOperator, badBetween, badIn, badHaving, metricOverride, noTime, noMetadata, method, path, hash, wire, nullCountry, numericMeasure, metricRow, badMetricAlias];
