import { dataset, dimension, measure } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { createAnalyticsHooks } from '../src/index.js';

const orders = dataset('orders', {
  source: 'orders',
  dimensions: { customerId: dimension.string(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount'), orderCount: measure.count('customerId') },
});
const revenue = orders.metric('revenue', { measure: 'revenue' });

const api = createAPI({ datasets: { orders }, metrics: { revenue }, queryBuilder: {} as never });
const hooks = createAnalyticsHooks<InferApiType<typeof api>>({ baseUrl: '/analytics' });

const result = hooks.useDataset('orders', {
  dimensions: ['customerId'],
  measures: ['revenue'],
  having: [{ measure: 'revenue', operator: 'gt', value: 1000 }],
});
// Having does not change the projection: the row type still follows the selection.
const revenueValue: string | null | undefined = result.data?.data[0]?.revenue;
void revenueValue;
hooks.useDataset('orders', {
  measures: ['orderCount'],
  having: [{ measure: 'orderCount', operator: 'between', value: [2, 10] }],
});
hooks.useInfiniteDataset('orders', {
  measures: ['revenue'],
  having: [{ measure: 'revenue', operator: 'in', value: [1, 2] }],
  limit: 10,
});
hooks.useQuery('dataset:orders', { measures: ['revenue'], having: [{ measure: 'revenue', operator: 'lte', value: 5 }] });

// @ts-expect-error having names a measure, not a dimension
hooks.useDataset('orders', { measures: ['revenue'], having: [{ measure: 'customerId', operator: 'gt', value: 1 }] });
// @ts-expect-error like does not apply to aggregated values
hooks.useDataset('orders', { measures: ['revenue'], having: [{ measure: 'revenue', operator: 'like', value: 1 }] });
// @ts-expect-error having values are numeric
hooks.useInfiniteDataset('orders', { measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gt', value: '1' }], limit: 10 });
// @ts-expect-error metric hooks do not accept having
hooks.useMetric('revenue', { having: [{ measure: 'revenue', operator: 'gt', value: 1 }] });
