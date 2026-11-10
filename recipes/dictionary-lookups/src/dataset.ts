import { belongsTo, dataset, dimension, measure } from '@hypequery/datasets';

/** The tenants table the dictionary is loaded from, for the JOIN version. */
export const Tenants = dataset('tenants', {
  source: 'dictionary_lookups_tenants_source',
  dimensions: {
    tenantId: dimension.number({ column: 'tenant_id' }),
    plan: dimension.string({ label: 'Plan' }),
    region: dimension.string({ label: 'Region' }),
  },
});

const eventDimensions = {
  eventId: dimension.number({ column: 'event_id' }),
  tenantId: dimension.number({ column: 'tenant_id' }),
  eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
  occurredAt: dimension.timestamp({ column: 'occurred_at' }),
};
const eventMeasures = {
  events: measure.count('eventId', { label: 'Events' }),
  tenants: measure.countDistinct('tenantId', { label: 'Active tenants' }),
};

/**
 * Events with the tenant's plan and region as ordinary dimensions, looked up
 * in an in-memory dictionary instead of joined. Callers ask for `plan` like
 * any other column.
 */
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    ...eventDimensions,
    plan: dimension.string({
      sql: "dictGet('dictionary_lookups_tenants', 'plan', tenant_id)",
      dependencies: ['tenant_id'],
      label: 'Plan',
    }),
    region: dimension.string({
      sql: "dictGet('dictionary_lookups_tenants', 'region', tenant_id)",
      dependencies: ['tenant_id'],
      label: 'Region',
    }),
  },
  measures: eventMeasures,
});

/** The same events, reaching plan and region through a relationship (a LEFT ANY JOIN). */
export const EventsJoined = dataset('eventsJoined', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: eventDimensions,
  measures: eventMeasures,
  relationships: {
    tenant: belongsTo(() => Tenants, { from: 'tenant_id', to: 'tenant_id' }),
  },
});
