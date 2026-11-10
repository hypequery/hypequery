-- A private copy of the seed events with each tenant's plan stamped on the
-- row at ingest, so retention rules can depend on it. The seed tables are
-- only read.
DROP TABLE IF EXISTS ttl_data_retention_events;

CREATE TABLE ttl_data_retention_events
(
    event_id     UInt64,
    tenant_id    UInt32,
    plan         LowCardinality(String),
    event_type   LowCardinality(String),
    path         String,
    latency_ms   UInt32,
    occurred_at  DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, occurred_at, event_id);

-- Hold merges so nothing is deleted before MATERIALIZE TTL, on every run.
-- Test technique only.
SYSTEM STOP MERGES ttl_data_retention_events;

INSERT INTO ttl_data_retention_events
SELECT e.event_id, e.tenant_id, t.plan, e.event_type, e.path, e.latency_ms, e.occurred_at
FROM events AS e
INNER JOIN tenants AS t ON t.tenant_id = e.tenant_id;

-- Retention per plan. In production this reads
--     toDate(occurred_at) + INTERVAL 30 DAY WHERE plan = 'free'
-- {seed_age_days} is the number of days between the seed's "today"
-- (2026-11-01) and the real today, filled in by src/setup.ts. Adding it makes
-- the cut-off land on the same seed date whenever the recipe runs.
-- materialize_ttl_after_modify = 0 records the rules without applying them
-- to existing parts yet, so the before/after is visible.
ALTER TABLE ttl_data_retention_events
    MODIFY TTL
        toDate(occurred_at) + INTERVAL 30 DAY + INTERVAL {seed_age_days} DAY WHERE plan = 'free',
        toDate(occurred_at) + INTERVAL 180 DAY + INTERVAL {seed_age_days} DAY WHERE plan = 'starter'
    SETTINGS materialize_ttl_after_modify = 0;

-- Column TTL: keep the request path for 7 days, then reset it to the
-- column default ('') while the row itself stays.
ALTER TABLE ttl_data_retention_events
    MODIFY COLUMN path String TTL toDate(occurred_at) + INTERVAL 7 DAY + INTERVAL {seed_age_days} DAY
    SETTINGS materialize_ttl_after_modify = 0;
