// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, measure } from '../../../src/index.js';

export const ActivityDataset = dataset('activity', {
  source: 'analytics.activity',
  timeKey: 'occurredAt',
  events: { entity: 'userId', event: 'eventName' },
  dimensions: {
    accountId: dimension.number({ column: 'account_id' }),
    eventName: dimension.string({ column: 'event_name' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    plan: dimension.string(),
    userId: dimension.string({ column: 'user_id' }),
  },
  measures: { events: measure.count('userId') },
  filters: {},
});

/** The datasets published with an endpoint. */
export const datasets = {
  activity: ActivityDataset,
};
