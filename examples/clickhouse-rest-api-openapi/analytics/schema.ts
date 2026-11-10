/**
 * The seed tables this API reads, in the shape `npx hypequery generate`
 * writes. Regenerate it against your own ClickHouse instead of editing by hand.
 */
export interface Schema {
  tenants: {
    tenant_id: 'UInt32';
    name: 'String';
    plan: 'LowCardinality(String)';
    region: 'LowCardinality(String)';
    industry: 'LowCardinality(String)';
    created_at: "DateTime('UTC')";
  };
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
