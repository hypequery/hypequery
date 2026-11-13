// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, divide, measure, nullIfZero } from '../../../src/index.js';

export const DailyUsersDataset = dataset('dailyUsers', {
  source: 'analytics.daily_users',
  timeKey: 'day',
  dimensions: { day: dimension.timestamp(), region: dimension.string() },
  measures: {
    activeUsers: measure.merge('uniq', 'users', { label: 'Active users' }),
    events: measure.merge('count', 'event_states'),
    exactUsers: measure.merge('uniqExact', 'exact_users'),
    revenue: measure.merge('sum', 'revenue_state'),
    revenuePerUser: measure.derived({
      uses: { revenue: 'revenue', exactUsers: 'exactUsers' },
      formula: ({ revenue, exactUsers }) => divide(revenue, nullIfZero(exactUsers)),
    }),
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  dailyUsers: DailyUsersDataset,
};
