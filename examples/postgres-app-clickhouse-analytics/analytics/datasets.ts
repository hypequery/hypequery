import { dataset, dimension, measure } from '@hypequery/datasets';

/**
 * Product usage, one row per event, in ClickHouse. `tenantId` is the join key
 * back to the Postgres `accounts.id`. This is an internal (staff) view across
 * accounts, so it filters by an explicit id list rather than a `tenantKey`;
 * see the multi-tenant example for the customer-facing version.
 */
export const Usage = dataset('usage', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    tenantId: dimension.number({ column: 'tenant_id', label: 'Account id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    activeUsers: measure.countDistinct('userId', { label: 'Active users' }),
    lastSeenAt: measure.max('occurredAt', { label: 'Last event' }),
  },
});
