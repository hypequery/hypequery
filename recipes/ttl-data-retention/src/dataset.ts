import { dataset, dimension, measure, neq } from '@hypequery/datasets';

/**
 * Events under a retention policy. The dataset knows nothing about TTL:
 * expired rows are simply gone after ClickHouse applies it, and expired
 * column values are reset to the column default (an empty path).
 */
export const Events = dataset('events', {
  source: 'ttl_data_retention_events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    plan: dimension.string({ label: 'Plan' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    path: dimension.string(),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    eventsWithPath: measure.count('eventId', { label: 'Events with a path', filters: [neq('path', '')] }),
    oldestEvent: measure.min('occurredAt', { label: 'Oldest event' }),
    newestEvent: measure.max('occurredAt', { label: 'Newest event' }),
  },
});
