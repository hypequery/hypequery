import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type AnyDatasetInstance,
  type DatasetCatalog,
  type DatasetTimeKeyNames,
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

// The selected axis is narrowed to the dataset's declared axes, like
// dimensions, measures and segments are.
// @ts-expect-error not a declared time axis.
client.execute(Orders, { measures: ['revenue'], by: 'day', timeKey: 'shipedAt' });
// @ts-expect-error not a declared time axis on the metric's dataset either.
client.execute(Orders.metric('totalRevenue', { measure: 'revenue' }), { by: 'week', timeKey: 'shipedAt' });
// @ts-expect-error a metric pinned to a grain still checks the axis.
client.execute(Orders.metric('totalRevenue', { measure: 'revenue' }).by('week'), { timeKey: 'shipedAt' });
client.execute(Orders.metric('totalRevenue', { measure: 'revenue' }).by('week'), { timeKey: 'delivered_at' });
// @ts-expect-error compileDataset checks the axis too.
client.compileDataset(Orders, { measures: ['revenue'], timeKey: 'shipedAt' });

const SingleAxis = dataset('single', {
  source: 'single',
  timeKey: 'created_at',
  dimensions: {},
  measures: { revenue: measure.sum('amount') },
});
// Naming the default is always allowed; there is nothing else to select.
client.execute(SingleAxis, { measures: ['revenue'], timeKey: 'created_at' });
// @ts-expect-error a dataset without alternates has only its default axis.
client.execute(SingleAxis, { measures: ['revenue'], timeKey: 'shipped_at' });

const NoAxis = dataset('none', { source: 'none', dimensions: {}, measures: { n: measure.count('id') } });
// @ts-expect-error a dataset without a timeKey has no axis to select.
client.execute(NoAxis, { measures: ['n'], timeKey: 'created_at' });

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const axes: Equal<DatasetTimeKeyNames<typeof Orders>, 'createdAt' | 'shippedAt' | 'delivered_at'> = true;
const noAxes: Equal<DatasetTimeKeyNames<typeof NoAxis>, never> = true;
// Wide datasets (built from a non-literal config) keep accepting any string.
const wideAxes: Equal<DatasetTimeKeyNames<AnyDatasetInstance>, string> = true;
const defaultAxis: 'createdAt' | undefined = Orders.timeKey;
void axes;
void noAxes;
void wideAxes;
void defaultAxis;

// A dynamically configured axis list stays usable, with string-typed selection.
declare const configuredKeys: string[];
const Dynamic = dataset('dynamic', {
  source: 'dynamic',
  timeKey: 'created_at',
  timeKeys: configuredKeys,
  dimensions: {},
  measures: { revenue: measure.sum('amount') },
});
client.execute(Dynamic, { measures: ['revenue'], timeKey: 'anything' });
