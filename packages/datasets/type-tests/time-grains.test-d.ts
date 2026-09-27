import { dataset, dimension, measure, type TimeGrain } from '../src/index.js';

const grains: TimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
void grains;

// @ts-expect-error `second` is not a time grain.
const second: TimeGrain = 'second';
void second;

const Events = dataset('events', {
  source: 'events',
  timeKey: 'created_at',
  timeGrains: ['hour', 'day'],
  dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }) },
  measures: { events: measure.count('id') },
});

Events.metric('hourly', { measure: 'events' }).by('hour');

dataset('bad', {
  source: 'events',
  timeKey: 'created_at',
  // @ts-expect-error timeGrains only accepts time grains.
  timeGrains: ['fortnight'],
  dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }) },
});
