/** Compiler regression fixture: 100 local fields, 1,000 related fields, 20 endpoints. */
import { dataset, dimension, measure, belongsTo, type DimensionDefinition } from '@hypequery/datasets';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { createAnalyticsHooks } from '../src/index.js';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type Field = `field${Digit}${Digit}`;
declare const dimensions: Record<Field, DimensionDefinition<'string'>>;
const target = dataset('target', { source: 'target', dimensions });
const relationship = belongsTo(() => target, { from: 'target_id', to: 'id' });
declare const relationships: Record<`related${Digit}`, typeof relationship>;
const large = dataset('large', {
  source: 'large', dimensions, relationships, measures: { total: measure.count('field00') },
});
declare const datasets: Record<`dataset${Digit}`, typeof large>;
declare const metrics: Record<`metric${Digit}`, ReturnType<typeof large.metric<'total'>>>;
const api = createAPI({ datasets, metrics, queryBuilder: {} as never });
const hooks = createAnalyticsHooks<InferApiType<typeof api>>({ baseUrl: '/analytics' });
hooks.useDataset('dataset0', { measures: ['total'], filters: [{ field: 'field00', operator: 'eq', value: 'x' }] });
hooks.useMetric('metric0', { filters: [{ field: 'related9.field99', operator: 'in', value: ['x'] }] });
