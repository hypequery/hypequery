import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type DatasetCatalog,
  type DatasetQuery,
  type MetricQuery,
  type QueryBuilderFactoryLike,
} from '../src/index.js';

declare const queryBuilder: QueryBuilderFactoryLike;
const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt', 'delivered_at'],
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
  },
  measures: { revenue: measure.sum('amount') },
});
const client = createDatasetClient({ queryBuilder });

client.execute(Orders, { measures: ['revenue'], by: 'day', timeKey: 'shippedAt' });
client.execute(Orders.metric('totalRevenue', { measure: 'revenue' }), { by: 'week', timeKey: 'shippedAt' });
client.compileDataset(Orders, { measures: ['revenue'], timeKey: 'delivered_at' });

const timeKeys: readonly string[] | undefined = Orders.timeKeys;
void timeKeys;
const catalogTimeKeys: string[] | undefined = ({} as DatasetCatalog).timeKeys;
void catalogTimeKeys;
const datasetQuery: DatasetQuery = { timeKey: 'shippedAt' };
const metricQuery: MetricQuery = { timeKey: 'shippedAt' };
void datasetQuery;
void metricQuery;

// @ts-expect-error a time key is a dimension name or column, not a list.
client.execute(Orders, { measures: ['revenue'], timeKey: ['shippedAt'] });

dataset('bad', {
  source: 'orders',
  timeKey: 'created_at',
  // @ts-expect-error timeKeys lists names, not a single string.
  timeKeys: 'shipped_at',
  dimensions: {},
});
