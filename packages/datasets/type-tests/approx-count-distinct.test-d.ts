import { approxCountDistinct, dataset, dimension, measure, type AggregationType } from '../src/index.js';

const aggregation: AggregationType = 'approxCountDistinct';
void aggregation;
void approxCountDistinct('user_id');

const Events = dataset('events', {
  source: 'events',
  dimensions: { userId: dimension.string({ column: 'user_id' }) },
  measures: { visitors: measure.approxCountDistinct('user_id') },
});

Events.metric('visitors', { measure: 'visitors' });
