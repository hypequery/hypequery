/**
 * The seed's `events` table as `npx hypequery generate` would type it, so the
 * query builder checks column names and result types at compile time.
 */
export interface Schema {
  events: {
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
}
