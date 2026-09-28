import { createDatasetClient, dataset, dimension, measure, type QueryBuilderFactoryLike } from '../src/index.js';

declare const queryBuilder: QueryBuilderFactoryLike;
const Events = dataset('events', {
  source: 'events', timeKey: 'time',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }) },
  measures: { revenue: measure.sum('value') },
});
const client = createDatasetClient({ queryBuilder, timezone: 'UTC' });
client.execute(Events, { by: 'day', timezone: 'America/New_York' });
client.execute(Events.metric('revenue', { measure: 'revenue' }), { by: 'hour', timezone: 'Asia/Tokyo' });
// @ts-expect-error timezone is no longer semantic metadata.
dimension.timestamp({ timezone: 'UTC' });
// @ts-expect-error timezone is a name, not an offset number.
client.execute(Events, { timezone: 9 });
