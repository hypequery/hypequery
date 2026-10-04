import { dataset, dimension, measure, belongsTo, hasOne } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { createAnalyticsHooks } from '../src/index.js';
const targets = dataset('targets', { source: 'targets', dimensions: { id: dimension.number() }, measures: { unique: measure.countDistinct('id'), total: measure.sum('id') } });
const sources = dataset('sources', { source: 'sources', dimensions: { id: dimension.number() }, relationships: { target: belongsTo(() => targets, { from: 'target_id', to: 'id' }), profile: hasOne(() => targets, { from: 'id', to: 'id' }) } });
const api = createAPI({ datasets: { sources }, queryBuilder: {} as never });
const hooks = createAnalyticsHooks<InferApiType<typeof api>>({ baseUrl: '/analytics' });
const result = hooks.useDataset('sources', { measures: ['target.unique'] });
const value: string | null | undefined = result.data?.data[0]?.['target.unique'];
void value;
// @ts-expect-error unselected measures are excluded from projection
result.data?.data[0]?.['profile.total'];
hooks.useInfiniteDataset('sources', { measures: ['profile.total'], limit: 10 });
// @ts-expect-error unsafe belongsTo aggregation is excluded through hooks
hooks.useDataset('sources', { measures: ['target.total'] });
// @ts-expect-error infinite hooks retain the safe query vocabulary
hooks.useInfiniteDataset('sources', { measures: ['target.total'], limit: 10 });
