// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, measure } from '../../../src/index.js';

export const DailyActiveUsersDataset = dataset('daily_active_users', {
  source: 'daily_active_users',
  dimensions: { day: dimension.timestamp() },
  measures: { active_users: measure.merge('uniq', 'users'), events: measure.merge('sum', 'events') },
  filters: {},
});

/** The datasets published with an endpoint. */
export const datasets = {
  daily_active_users: DailyActiveUsersDataset,
};
