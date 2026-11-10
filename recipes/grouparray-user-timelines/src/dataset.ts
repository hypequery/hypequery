import { dataset, dimension, measure } from '@hypequery/datasets';

/**
 * Per-user activity summary: how many events, when the first and last
 * happened, and which path each was on. These are scalar aggregates, so they
 * are dataset measures every caller can share.
 *
 * The ordered timeline itself is an array (`groupArray`), which is not a
 * dataset measure type today; src/recipe.ts builds it with the query builder,
 * and the smoke test checks the two agree on the first and last step.
 */
export const UserActivity = dataset('userActivity', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    userId: dimension.number({ column: 'user_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    path: dimension.string(),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    firstEventAt: measure.min('occurredAt', { label: 'First event' }),
    lastEventAt: measure.max('occurredAt', { label: 'Last event' }),
    firstPath: measure.argMin('path', 'occurredAt', { label: 'First path' }),
    lastPath: measure.argMax('path', 'occurredAt', { label: 'Last path' }),
  },
});
