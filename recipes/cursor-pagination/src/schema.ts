/**
 * The seed's `events` table as hypequery sees it (`npx hypequery generate`
 * writes this for you). Sort key: (tenant_id, occurred_at, event_id), so
 * "one tenant's events in time order" is a contiguous range of the index,
 * and (occurred_at, event_id) is a unique, ordered cursor within a tenant.
 *
 * `cursor_pagination_events` is the recipe's own compacted copy, used only to
 * measure what each pagination style reads (see src/cost.ts).
 */
type EventColumns = {
  event_id: 'UInt64';
  tenant_id: 'UInt32';
  user_id: 'UInt32';
  event_type: 'LowCardinality(String)';
  path: 'String';
  status_code: 'UInt16';
  latency_ms: 'UInt32';
  device: 'LowCardinality(String)';
  occurred_at: "DateTime('UTC')";
};

export type Schema = {
  events: EventColumns;
  cursor_pagination_events: EventColumns;
};
