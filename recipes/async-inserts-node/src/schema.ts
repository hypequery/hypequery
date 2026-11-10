/**
 * The recipe's own ingest table. Merges are stopped on it while measuring
 * (see src/table.ts), so the active part count is exactly the number of
 * parts the inserts created.
 */
export type Schema = {
  async_inserts_node_events: {
    event_id: 'UInt64';
    tenant_id: 'UInt32';
    user_id: 'UInt32';
    event_type: 'LowCardinality(String)';
    occurred_at: "DateTime('UTC')";
  };
};

export const TABLE = 'async_inserts_node_events' as const;

export const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE}
(
    event_id     UInt64,
    tenant_id    UInt32,
    user_id      UInt32,
    event_type   LowCardinality(String),
    occurred_at  DateTime('UTC')
)
ENGINE = MergeTree
ORDER BY (tenant_id, occurred_at, event_id)`;
