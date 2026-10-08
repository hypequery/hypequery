import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type DatasetHavingFor,
  type DatasetQueryFor,
} from '../src/index.js';

const orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    customerId: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('customerId'),
  },
});

declare const client: ReturnType<typeof createDatasetClient>;

const comparison: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'gt', value: 100 };
const range: DatasetHavingFor<typeof orders> = { measure: 'orderCount', operator: 'between', value: [1, 10] };
const list: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'in', value: [1, 2] };
void comparison;
void range;
void list;

const query: DatasetQueryFor<typeof orders> = {
  dimensions: ['customerId'],
  measures: ['revenue'],
  having: [{ measure: 'revenue', operator: 'gte', value: 1_000 }],
};
void client.execute(orders, query);
void client.execute(orders, {
  measures: ['revenue'],
  having: [{ measure: 'revenue', operator: 'lt', value: 5 }],
});

// @ts-expect-error dimensions are not measures
const dimensionMeasure: DatasetHavingFor<typeof orders> = { measure: 'customerId', operator: 'gt', value: 1 };
// @ts-expect-error unknown measures are rejected
const unknownMeasure: DatasetHavingFor<typeof orders> = { measure: 'profit', operator: 'gt', value: 1 };
// @ts-expect-error like does not apply to aggregated values
const likeOperator: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'like', value: 1 };
// @ts-expect-error values are numeric
const stringValue: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'gt', value: '100' };
// @ts-expect-error between takes a two-item range
const scalarRange: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'between', value: 5 };
// @ts-expect-error in takes a list
const scalarList: DatasetHavingFor<typeof orders> = { measure: 'revenue', operator: 'in', value: 5 };
void [dimensionMeasure, unknownMeasure, likeOperator, stringValue, scalarRange, scalarList];

// @ts-expect-error execute() narrows having to the dataset's measures
void client.execute(orders, {
  measures: ['revenue'],
  having: [{ measure: 'amount', operator: 'gt', value: 1 }],
});
