import { dataset, dimension, measure, belongsTo, hasOne } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '../src/index.js';
const targets = dataset('targets', { source: 'targets', dimensions: { id: dimension.number() }, measures: { unique: measure.countDistinct('id'), total: measure.sum('id') } });
const sources = dataset('sources', { source: 'sources', dimensions: { id: dimension.number() }, relationships: { target: belongsTo(() => targets, { from: 'target_id', to: 'id' }), profile: hasOne(() => targets, { from: 'id', to: 'id' }) } });
const api = createAPI({ datasets: { sources }, queryBuilder: {} as never });
type Api = InferApiType<typeof api>;
const query: Api['dataset:sources']['input'] = { measures: ['target.unique', 'profile.total'] };
void query;
// @ts-expect-error unsafe belongsTo aggregation is excluded through Serve
const bad: Api['dataset:sources']['input'] = { measures: ['target.total'] };
void bad;
api.run('dataset:sources', { input: { measures: ['target.unique'] } });
// @ts-expect-error execution retains the same query vocabulary
api.run('dataset:sources', { input: { measures: ['target.total'] } });
